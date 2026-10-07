/** Presentation tree. No provider data, semantic resource registry, or measured geometry. */
export type DisplayInline =
    | { type: 'text'; text: string }
    | { type: 'strong' | 'emphasis' | 'strikethrough'; children: DisplayInline[] }
    | { type: 'inlineCode'; code: string }
    | { type: 'link'; href: string; title?: string; children: DisplayInline[] }
    | { type: 'citation'; id: string; label: string; href?: string }
    | { type: 'image'; resourceId: string; alt: string; title?: string }
    | { type: 'placeholder'; enclosure?: 'brackets'; text: string }
    | { type: 'inlineMath'; source: string }
    | { type: 'lineBreak'; kind: 'soft' | 'hard' };

export interface DisplayCell {
    children: DisplayInline[];
    column: number;
    colSpan: number;
    rowSpan: number;
    align: 'left' | 'center' | 'right' | 'default';
}

export type DisplayBlock =
    | { type: 'paragraph'; children: DisplayInline[] }
    | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: DisplayInline[] }
    | { type: 'list'; ordered: boolean; start?: number; items: Array<{ blocks: DisplayBlock[] }> }
    | { type: 'quote'; blocks: DisplayBlock[] }
    | { type: 'code'; code: string; language: string; header: string; meta?: string; copy?: { label: string; title: string } }
    | { type: 'math'; source: string }
    | { type: 'table'; caption?: DisplayInline[]; columnAlignments: DisplayCell['align'][]; headerRows: DisplayCell[][]; rows: DisplayCell[][] }
    | { type: 'image'; resourceId: string; alt: string; caption?: DisplayInline[] }
    | { type: 'file'; resourceId: string; label: string; badge: string; openLabel: string; description?: DisplayInline[] }
    | { type: 'disclosure'; title: string; initiallyCollapsed: boolean; blocks: DisplayBlock[] }
    | { type: 'thematicBreak' }
    | { type: 'placeholder'; enclosure?: 'brackets'; text: string; badge: string; details?: DisplayInline[] }
    | { type: 'unsupported'; sourceType: string; label: string; text: string };

export interface SourceGroup {
    type: 'sources';
    heading?: DisplayInline[];
    items: Array<{ id: string; label: string; href?: string; prefix?: string }>;
}

export interface DisplayMessage {
    type: 'message';
    id: string;
    anchor: string;
    variant: 'bubble' | 'flow';
    heading?: { level: 1 | 2 | 3 | 4 | 5 | 6; text: string };
    blocks: DisplayBlock[];
    sources?: SourceGroup;
    folding?: { initiallyCollapsed: boolean; moreLabel: string; lessLabel: string };
}

export interface DocumentAst {
    schemaVersion: 1;
    profile: { id: 'html' | 'markdown'; version: 1 };
    language: 'zh-CN' | 'en';
    theme: 'dark' | 'light';
    header: { title: string; metadata: string };
    frontMatter?: Array<{ key: string; value: string | string[] }>;
    mathFallbackLabel: string;
    messages: DisplayMessage[];
    emptyNotice?: string;
}

/** Output URLs are supplied by export preparation; bytes never enter the tree. */
export type ResourceBindings = Readonly<Record<string, string>>;

export interface DocumentDiagnostic {
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    path?: string;
}
