/**
 * src/types/conversation.ts
 * Single source of truth for Conversation, Turn, Attachment, and Title data models.
 */

export type TitleSource =
    | 'rpc'
    | 'dom'
    | 'takeout'
    | 'sniff'
    | 'api-detail'
    | 'legacy'
    | 'default';

export interface TitleSources {
    rpc?: string;
    dom?: string;
    takeout?: string;
    sniff?: string;
    'api-detail'?: string;
    legacy?: string;
    [key: string]: string | undefined;
}

export type AttachmentType = 'image' | 'file' | 'doc' | 'grounding' | 'code';

export interface Attachment {
    type: AttachmentType | string;
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
    isImage?: boolean;
    dataBuffer?: ArrayBuffer | ArrayBufferView;
    blobBase64?: string;
    dataBase64?: string;
}

export type AuthorRole = 'user' | 'model' | 'assistant' | 'system';

export interface ChatMessage {
    role: AuthorRole;
    content: string;
    /** Server-authoritative message time; null when the server provided none (never fabricate Date.now()). */
    timestamp?: number | null;
    turnId?: string;
    attachments?: Attachment[];
    thoughts?: string | string[];
    thinking?: string;
    images?: Attachment[];
    attachmentCount?: number;
    sources?: unknown[];
}

export type Message = ChatMessage;

export interface Turn {
    id?: string;
    timestamp?: number | null;
    messages?: ChatMessage[];
    userContent?: string;
    modelContent?: string;
    thoughts?: string | string[];
    attachments?: Attachment[];
    images?: Attachment[];
    sources?: unknown[];
}

export interface Conversation {
    id: string;
    title: string;
    timestamp: number | null;
    updatedAt?: number | string;
    createdAt?: number | string;
    chatTime?: number | string;
    lastSeen?: number | string;
    /**
     * Client-observed interaction recency (touch path: stream start/complete,
     * live turn). Display-sort signal only — never feeds timestamp authority.
     * Stored as ms epoch (unlike lastSeen's ISO string).
     */
    lastActiveAt?: number;
    source?: string;
    titleSource?: TitleSource | string;
    titles?: TitleSources;
    messages?: ChatMessage[];
    turns?: Turn[];
    accountSlot?: string;
    isTakeoutOnly?: boolean;
    hitGoogleLimit?: boolean;
    url?: string;
    attachmentCount?: number;
    messageCount?: number;
    href?: string;
    hasExplicitPrompt?: boolean;
}
