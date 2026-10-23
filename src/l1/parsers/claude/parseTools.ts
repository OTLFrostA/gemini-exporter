import type { BlockNode } from '../../../l2/content/blocks.js';

export function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}
export function plain(text: string): BlockNode {
    return { type: 'paragraph', children: [{ type: 'text', text }] };
}
interface ToolContent { blocks: BlockNode[]; issues: string[] }
const toolName = (value: unknown) => typeof value === 'string' ? value.replace(/_/g, '').toLowerCase() : '';
function link(label: string, url: unknown): BlockNode {
    // Untrusted source URLs must never turn into executable links.
    return typeof url === 'string' && /^https?:\/\//i.test(url)
        ? { type: 'paragraph', children: [{ type: 'link', href: url,
            children: [{ type: 'text', text: label }] }] } : plain(label);
}

/** Native widgets are projected into shared semantic blocks, without exporting internal tool inputs. */
export function parseToolUse(block: Record<string, unknown>): ToolContent {
    const input = record(block.input);
    const name = toolName(block.name);
    const blocks: BlockNode[] = [], issues: string[] = [];
    if (name === 'artifacts') {
        if (typeof input?.content === 'string' && (input.command === undefined || input.command === 'create')) {
            blocks.push(plain('Artifact: ' + (typeof input.title === 'string' ? input.title : 'Artifact')),
                { type: 'code', code: input.content,
                    ...(typeof input.language === 'string' ? { language: input.language } : {}) });
        } else issues.push('Unsupported artifact operation or missing artifact content');
    } else if (name === 'askuserquestion') {
        if (!Array.isArray(input?.questions) || !input.questions.length) issues.push('Missing questionnaire questions');
        else for (const raw of input.questions) {
            const question = record(raw);
            if (!question || typeof question.question !== 'string' || !question.question.trim()) {
                issues.push('Invalid questionnaire question'); continue;
            }
            if (typeof question.header === 'string') blocks.push(plain(question.header));
            blocks.push(plain(question.question));
            if (typeof question.multiSelect === 'boolean')
                blocks.push(plain(question.multiSelect ? 'Multiple selections allowed' : 'Single selection'));
            if (!Array.isArray(question.options) || !question.options.length) {
                issues.push('Missing questionnaire options'); continue;
            }
            const items: { blocks: BlockNode[] }[] = [];
            for (const rawOption of question.options) {
                const option = record(rawOption);
                if (!option || typeof option.label !== 'string' || !option.label.trim()) {
                    issues.push('Invalid questionnaire option'); continue;
                }
                items.push({ blocks: [plain(option.label),
                    ...(typeof option.description === 'string' ? [plain(option.description)] : [])] });
            }
            blocks.push({ type: 'list', ordered: false, items });
        }
    } else if (name === 'websearch') {
        if (typeof input?.query === 'string') blocks.push(plain('Web search: ' + input.query));
        else issues.push('Missing web search query');
    } else if (name === 'mcpmemorymemorywrite') {
        // Memory persistence is an operational side effect, not an authored Artifact.
        blocks.push(plain('Memory update'));
    } else if (['toolsearch', 'listconnectors', 'searchmcpregistry', 'suggestconnectors'].includes(name)) {
        // Discovery parameters/registry IDs are orchestration metadata. The associated
        // result carries the actual connector cards or tool references.
    } else issues.push('Unsupported tool: ' + String(block.name ?? 'unknown'));
    if (issues.length) blocks.push({ type: 'unknown', sourceType: 'claude.tool_use',
        text: 'Tool: ' + String(block.name ?? 'unknown') });
    return { blocks, issues };
}

function connectorCards(text: string): ToolContent {
    const blocks: BlockNode[] = [], issues: string[] = [];
    let value: unknown;
    try { value = JSON.parse(text); } catch { return { blocks: [plain(text)], issues: ['Invalid connector result JSON'] }; }
    const entries = Array.isArray(value) ? value : record(value)?.results;
    if (!Array.isArray(entries)) return { blocks: [plain(text)], issues: ['Missing connector result list'] };
    if (!entries.length) blocks.push(plain('No connectors found'));
    for (const entry of entries) {
        const card = record(entry);
        if (!card || typeof card.name !== 'string') { issues.push('Invalid connector card'); continue; }
        blocks.push(link(card.name, card.url));
        if (typeof card.description === 'string') blocks.push(plain(card.description));
    }
    return { blocks, issues };
}

export function parseToolResult(block: Record<string, unknown>,
    parseMarkdown: (text: string) => BlockNode[]): ToolContent {
    const name = toolName(block.name);
    const blocks: BlockNode[] = [], issues: string[] = [];
    // Keep execution outcome, but omit internal version tokens and stored profile bodies.
    if (['memorywrite', 'mcpmemorymemorywrite'].includes(name) && block.is_error !== true) {
        blocks.push(plain('Memory update completed'));
        return { blocks, issues };
    }
    const references = record(block.meta)?.tool_references;
    if (name === 'toolsearch' && Array.isArray(references)) {
        for (const ref of references) if (typeof ref === 'string') blocks.push(plain('Available tool: ' + ref));
    }
    const content = typeof block.content === 'string' ? [{ type: 'text', text: block.content }] : block.content;
    if (!Array.isArray(content)) issues.push('Missing tool result content');
    else for (const raw of content) {
        const part = record(raw);
        if (part?.type === 'text' && typeof part.text === 'string') {
            if (!part.text.trim()) continue;
            if (['listconnectors', 'searchmcpregistry', 'suggestconnectors'].includes(name)) {
                const parsed = connectorCards(part.text);
                blocks.push(...parsed.blocks); issues.push(...parsed.issues);
            } else blocks.push(...parseMarkdown(part.text));
        } else if (part?.type === 'knowledge' && typeof part.title === 'string') {
            blocks.push(link(part.title, part.url));
            if (typeof part.url !== 'string' || !/^https?:\/\//i.test(part.url))
                issues.push('Missing or unsafe search result URL');
            if (typeof part.text === 'string') blocks.push(...parseMarkdown(part.text));
            if (part.is_missing === true) issues.push('Missing search result content');
        } else {
            issues.push('Unsupported tool result content: ' + String(part?.type ?? 'unknown'));
            blocks.push({ type: 'unknown', sourceType: 'claude.tool_result', text: 'Unsupported tool result content' });
        }
    }
    if (block.is_error === true) blocks.unshift(plain('Tool execution failed'));
    return { blocks, issues };
}
