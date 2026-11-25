import { payloadToMs } from './payload.js';
import { decodeDocumentLinks } from './cardNodes.js';
import { isWireArray, isWireRecord } from './jspbSchema.js';
import { deepWalk, RESEARCH_PROMPT_PREFIX_RE, GEMINI_JSPB_SCHEMA } from './extractors.js';

export interface DeepResearchDocMeta {
    id: string;
    title: string;
    chipUrl?: string;
    createdAt?: number;
    contentId?: string;
    source?: 'strict' | 'heuristic-flat';
}

export interface DocLink {
    title: string;
    url: string;
}

interface DocSectionsResult {
    sections: string[];
    links: DocLink[];
    contentMarkdown: string;
    contentMatch?: 'exact' | 'substring';
}

export function extractDocumentsMeta(root: unknown): DeepResearchDocMeta[] {
    const out: DeepResearchDocMeta[] = [];
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const researchPrefixRe = RESEARCH_PROMPT_PREFIX_RE;
    const doc = GEMINI_JSPB_SCHEMA.DEEP_RESEARCH_DOC;

    function pushMeta(metaObj: DeepResearchDocMeta): void {
        if (!metaObj.id || !metaObj.title) return;
        const cleanTitle = researchPrefixRe.test(metaObj.title) ? '' : metaObj.title;
        const key = metaObj.id || metaObj.chipUrl || '';
        if (key && out.some(m => (m.id || m.chipUrl || '') === key)) return;
        out.push({
            id: metaObj.id,
            title: cleanTitle,
            chipUrl: metaObj.chipUrl,
            createdAt: metaObj.createdAt,
            contentId: metaObj.contentId,
            source: metaObj.source,
        });
    }

    // Pass 1: strict path only — typed indices, never marked heuristic.
    deepWalk([root], node => {
        if (!isWireArray(node)) return;
        for (let i = 0; i < node.length; i++) {
            const fields = node[i];
            if (!isWireArray(fields) || fields.length < 4) continue;
            const chip = fields[doc.CHIP_URL];
            const chipParts = isWireArray(chip) ? chip : null;
            const chipUrl = chipParts?.[0];
            const linkedDocument = decodeDocumentLinks([fields]) !== null;
            const id = fields[linkedDocument ? 1 : doc.ID];
            const rawTitle = fields[doc.TITLE];
            if (typeof chipUrl !== 'string' || !chipUrl.includes('immersive_entry_chip')
                || typeof id !== 'string' || typeof rawTitle !== 'string') continue;

            const rawTimestamp = fields[doc.TIMESTAMP];
            const createdAt = payloadToMs(isWireArray(rawTimestamp) ? rawTimestamp[0] : undefined) ?? undefined;
            const rawContentId = fields[doc.CONTENT_ID];
            const contentId = !linkedDocument && typeof rawContentId === 'string' && rawContentId.length > 10
                ? rawContentId : undefined;
            pushMeta({ id, title: rawTitle, chipUrl, createdAt, contentId });
        }
    });
    if (out.length > 0) return out;

    // Pass 2: flat fallback, only when the strict path produced nothing.
    deepWalk([root], node => {
        if (!isWireArray(node)) return;
        for (let i = 0; i < node.length; i++) {
            const item = node[i];
            if (!isWireArray(item)) continue;
            try {
                const flat = item.flat(Infinity).filter((x): x is string => typeof x === 'string');
                if (flat.length > 500) continue;
                const chip = flat.find(x => x.includes('immersive_entry_chip'));
                if (chip) {
                    const uuid = flat.find(x => uuidRe.test(x));
                    const title = flat.find(x => !x.includes('http') && !uuidRe.test(x) && x.length >= 8 && !x.includes('c_') && !x.includes('.html') && !researchPrefixRe.test(x));
                    pushMeta({
                        id: uuid || flat.find(x => x.includes('rc_')) || chip,
                        title: title || '',
                        chipUrl: chip,
                        source: 'heuristic-flat',
                    });
                }
            } catch (e) { console.debug('[GemExporter:attachments.ts]', e); }
        }
    });
    return out;
}

/** One lazy response scan shared by every Turn. Raw nodes never leave this decoder. */
export interface GeminiDocumentReader {
    byId(id: string): DocSectionsResult | null;
    byTitle(meta: DeepResearchDocMeta): string;
}

function walkDocumentEvidence(node: unknown, visit: (arr: unknown[]) => void, depth = 0): void {
    if (!node || depth > 25) return;
    if (isWireArray(node)) {
        visit(node);
        const isCandidateTuple = typeof node[0] === 'string' && node[0].startsWith('rc_');
        for (let i = 0; i < node.length; i++) {
            // Candidate body (slot 1) is assistant narrative and slot 2 is source citation metadata;
            // neither owns standalone Deep Research document bodies.
            if (isCandidateTuple && (i === 1 || i === 2)) continue;
            walkDocumentEvidence(node[i], visit, depth + 1);
        }
    } else if (isWireRecord(node)) {
        for (const key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key)) {
                walkDocumentEvidence(node[key], visit, depth + 1);
            }
        }
    }
}

export function createDocumentReader(root: unknown): GeminiDocumentReader {
    const candidates: { node: unknown[]; identifiers: string[] }[] = [];
    const markdown = new Map<string, Set<string>>();
    const parsed = new Map<unknown[], DocSectionsResult>();
    const matches = new Map<string, DocSectionsResult | null>();
    let indexed = false;
    function index(): void {
        if (indexed) return;
        indexed = true;
        walkDocumentEvidence(root, node => {
            const strings = node.filter((value): value is string => typeof value === 'string');
            const hasSections = node.some(x => isWireArray(x) && x.some(y => isWireArray(y) && typeof y[0] === 'string' && y[0].length > 50));
            const hasLongStr = strings.some(value => value.length > 200 && (value.includes('#') || value.includes('\n\n')));
            if (hasSections || hasLongStr) candidates.push({ node, identifiers: strings });
            for (const text of strings) {
                if (text.length <= 200 || !(text.includes('# ') || text.includes('\n\n'))
                    || text.includes('immersive_entry_chip') || text.includes('BardErrorInfo')) continue;
                const heading = /^\s*#{1,6}[ \t]+([^\r\n]+)/.exec(text);
                const title = heading?.[1].replace(/[ \t]+#+[ \t]*$/, '').trim();
                if (!title) continue;
                const values = markdown.get(title) ?? new Set<string>();
                values.add(text);
                markdown.set(title, values);
            }
        });
    }
    return {
        byId(id) {
            if (!id) return null;
            index();
            if (matches.has(id)) return matches.get(id) ?? null;
            const target = id.replace(/^c_/, '');
            const exact = candidates.filter(({ identifiers }) => identifiers.some(value => value === id || value === target));
            if (exact.length) {
                const records = exact.map(({ node }) => {
                    let sections = parsed.get(node);
                    if (!sections) { sections = parseDocSections(node); parsed.set(node, sections); }
                    return sections;
                });
                const first = records[0];
                const result = records.every(record => JSON.stringify(record) === JSON.stringify(first)) ? first : null;
                matches.set(id, result);
                return result;
            }
            for (const { node, identifiers } of candidates) {
                const value = identifiers.find(value => value === id || value === target
                    || (value.length < 80 && (value.includes(id) || value.includes(target))));
                if (value === undefined) continue;
                let sections = parsed.get(node);
                if (!sections) { sections = parseDocSections(node); parsed.set(node, sections); }
                const result: DocSectionsResult = {
                    ...sections,
                    ...(value !== id && value !== target ? { contentMatch: 'substring' } : {}),
                };
                matches.set(id, result);
                return result;
            }
            matches.set(id, null);
            return null;
        },
        byTitle(meta) {
            const title = meta.title.trim();
            if (!title || title === 'Document') return '';
            index();
            const values = markdown.get(title);
            return values?.size === 1 ? [...values][0] : '';
        },
    };
}

function walkDocSectionNodes(node: unknown, root: unknown, visit: (arr: unknown[]) => void, depth = 0): void {
    if (!isWireArray(node) || depth > 25) return;
    if (node !== root
        && node.some(item => typeof item === 'string' && item.length > 0 && item.length <= 50 && !item.startsWith('http'))
        && node.some(item => isWireArray(item))) {
        return;
    }
    visit(node);
    for (const child of node) walkDocSectionNodes(child, root, visit, depth + 1);
}

export function parseDocSections(docContentArr: unknown, contentMatch?: 'substring'): DocSectionsResult {
    const sections: string[] = [];
    const links: DocLink[] = [];
    let contentMarkdown = '';
    if (!isWireArray(docContentArr)) return { sections, links, contentMarkdown, contentMatch };

    walkDocSectionNodes(docContentArr, docContentArr, node => {
        if (node.length >= 2 && typeof node[0] === 'string' && typeof node[1] === 'string' && node[1].startsWith('http')) {
            links.push({ title: node[0], url: node[1] });
        }
        if (node.length >= 1 && typeof node[0] === 'string' && node[0].length > 50) {
            const text = node[0];
            if (!sections.includes(text)) sections.push(text);
        }
    });
    if (sections.length) {
        contentMarkdown = sections.join('\n\n');
    }
    return {
        sections,
        links,
        contentMarkdown,
        contentMatch,
    };
}
