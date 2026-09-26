import type { ProviderExtensions } from './json.js';
import type { SourceRef } from './provenance.js';

export type CitationKind = 'web' | 'file' | 'attachment' | 'provider' | 'other';

export interface Citation {
    id: string;
    kind: CitationKind;

    url?: string;
    title?: string;
    publisher?: string;
    snippet?: string;
    assetId?: string;

    sourceRef?: SourceRef;
    extensions?: ProviderExtensions;
}
