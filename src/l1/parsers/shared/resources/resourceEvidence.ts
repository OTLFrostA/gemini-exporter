import type { SourceGeneratedMediaIdentity } from './generationEvent.js';

/** Clean acquisition record before constructing the final Domain resource. */
export interface ResourceEvidence {
    type: string;
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
    size?: number;
    width?: number;
    height?: number;
    source?: string;
    subDir?: string;
    isGenerated?: boolean;
    providerRequestId?: string;
    imageOrdinal?: number;
    generation?: Omit<SourceGeneratedMediaIdentity, 'time'> & { time?: number };
    isImage?: boolean;
    blobBase64?: string;
    dataBase64?: string;
    /** Document metadata belongs to its resource record. */
    id?: string;
    createdAt?: number;
    chipUrl?: string;
    sections?: string[];
    links?: Array<{ title: string; url: string }>;
    contentMarkdown?: string;
    candidates?: string[];
    hasFabricatedText?: boolean;
}

