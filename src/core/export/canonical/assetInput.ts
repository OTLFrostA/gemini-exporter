import type { GeneratedMediaIdentity } from '../../../types/conversation.js';

export interface AssetNormalizationInput {
    type?: string;
    isImage?: boolean;
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
    isGenerated?: boolean;
    providerRequestId?: string;
    imageOrdinal?: number;
    generation?: GeneratedMediaIdentity;
    dataBuffer?: ArrayBuffer | ArrayBufferView | number[];
    blobBase64?: string;
    dataBase64?: string;
    contentMarkdown?: string;
    failureReason?: string;
}
