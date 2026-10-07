import type { DomainGeneratedMediaIdentity as GeneratedMediaIdentity } from '../../../domain/conversationDetail.js';

/** Parser-owned transport evidence. Never serialized as Domain or Document AST. */
export interface ResourceAcquisitionHint {
    url?: string;
    sourceUrl?: string;
    resolvedUrl?: string;
    src?: string;
    localName?: string;
    fileName?: string;
    name?: string;
    title?: string;
    mimeType?: string;
    mime?: string;
    candidates?: string[];
    providerRequestId?: string;
    imageOrdinal?: number;
    generation?: GeneratedMediaIdentity;
}

/** Domain asset identity, rather than a URL or export destination, owns acquisition. */
export type ResourceAcquisitionHints = Readonly<Record<string, ResourceAcquisitionHint>>;
