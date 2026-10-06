import type { GeneratedMediaIdentity } from '../../types/conversation.js';

/** Clean acquisition record before constructing the final Domain resource. */
export interface LegacyAttachmentRecord {
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
    generation?: GeneratedMediaIdentity;
    isImage?: boolean;
    blobBase64?: string;
    dataBase64?: string;
    failureReason?: string;
    /** Document metadata belongs to its resource record. */
    id?: string;
    createdAt?: number | null;
    chipUrl?: string;
    sections?: string[];
    links?: Array<{ title: string; url: string }>;
    contentMarkdown?: string;
    candidates?: string[];
    hasFabricatedText?: boolean;
}

