/** Format-neutral logical presentation tree. Styles, output controls and geometry live in backends. */
export type DisplayInline =
    | { type: 'text'; text: string }
    | { type: 'strong' | 'emphasis' | 'strikethrough'; children: DisplayInline[] }
    | { type: 'inlineCode'; code: string }
    | { type: 'link'; href: string; title?: string; children: DisplayInline[] }
    | { type: 'citation'; id: string; label: string; href?: string }
    | { type: 'image'; resourceId: string; alt: string; title?: string }
    | { type: 'placeholder'; resourceId?: string; kind: 'image' | 'file'; text: string }
    | { type: 'inlineMath'; source: string }
    | { type: 'lineBreak'; kind: 'soft' | 'hard' };

export interface DisplayCell {
    children: DisplayInline[];
    column: number;
    colSpan: number;
    rowSpan: number;
    align: 'left' | 'center' | 'right' | 'default';
}

export type DisplayBlock = (
    | { type: 'paragraph'; children: DisplayInline[] }
    | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: DisplayInline[] }
    | { type: 'list'; ordered: boolean; start?: number; items: Array<{ blocks: DisplayBlock[] }> }
    | { type: 'quote'; blocks: DisplayBlock[] }
    | { type: 'code'; code: string; language?: string; filename?: string; meta?: string; showHeader: boolean }
    | { type: 'math'; source: string }
    | { type: 'table'; caption?: DisplayInline[]; columnAlignments: DisplayCell['align'][]; headerRows: DisplayCell[][]; rows: DisplayCell[][] }
    | { type: 'image'; resourceId: string; alt: string; caption?: DisplayInline[] }
    | { type: 'file'; resourceId: string; label: string; kind: string; mediaType?: string; byteLength?: number; description?: DisplayInline[] }
    | { type: 'disclosure'; kind: string; title?: string; initiallyCollapsed?: boolean; blocks: DisplayBlock[] }
    | { type: 'thematicBreak' }
    | { type: 'placeholder'; resourceId?: string; kind: 'image' | 'file'; text: string; details?: DisplayInline[] }
    | { type: 'unsupported'; sourceType: string; text: string }
);

export interface SourceGroup {
    type: 'sources';
    heading?: DisplayInline[];
    items: Array<{ id: string; label: string; href?: string; number?: number }>;
}

export interface DisplayMessage {
    type: 'message';
    id: string;
    variant: 'bubble' | 'flow';
    heading?: { level: 1 | 2 | 3 | 4 | 5 | 6; text: string };
    label: 'you' | 'assistant' | 'system' | 'developer' | 'unknown';
    modelLabel?: string;
    blocks: DisplayBlock[];
    sources?: SourceGroup;
}

export interface DocumentAst {
    schemaVersion: 2;
    documentLanguage?: string;
    header: {
        title: string;
        providerLabel: string;
        /** UTC YYYY-MM-DD display date, not an export date or a raw timestamp.
         * First valid fact: updatedAt, lastSeen, createdAt, timestamp, chatTime.
         * Compatibility inputs expose only updatedAt and createdAt. Omitted if none is valid.
         * Composers select it once; backends must not reselect or reinterpret it.
         */
        date?: string;
        messageCount: number;
    };
    emptyNotice?: string;
    messages: DisplayMessage[];
}

/** Output URLs are supplied by export preparation; bytes never enter the tree. */
export type ResourceBindings = Readonly<Record<string, string>>;
