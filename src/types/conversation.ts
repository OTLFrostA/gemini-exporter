/**
 * src/types/conversation.ts
 * Single source of truth for Conversation, Turn, Attachment, and Title data models.
 */

export type TitleSource =
    | 'sniff'
    | 'dom'
    | 'user-edit'
    | 'takeout'
    | 'api-detail'
    | 'api-list'
    | 'url';

export interface TitleSources {
    sniff?: string;
    dom?: string;
    'user-edit'?: string;
    takeout?: string;
    'api-detail'?: string;
    'api-list'?: string;
    url?: string;
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
    timestamp?: number;
    turnId?: string;
    attachments?: Attachment[];
    /**
     * P1-090: honest type. parseDetail writes a single joined string
     * (extractThoughts returns string|null), chatgptProvider writes string[].
     */
    thoughts?: string | string[];
    /** Legacy field still read by chatFormatter; no writer left in src. */
    thinking?: string;
    /** Runtime-populated by domScraper / takeout / batchWorker (attachment-like entries). */
    images?: Attachment[];
    /** Written by parseDetail (atts.length); read by pagination/export for badge counts. */
    attachmentCount?: number;
    /**
     * Ghost contract (P1-100): nothing in src populates `sources`.
     * Kept as unknown[] for stored-data forward compatibility.
     */
    sources?: unknown[];
}

export type Message = ChatMessage;


export interface Turn {
    id?: string;
    timestamp?: number; // In milliseconds
    messages?: ChatMessage[];
    userContent?: string;
    modelContent?: string;
    thoughts?: string | string[];
    attachments?: Attachment[];
    /** Runtime-populated image entries (takeout/batchWorker). */
    images?: Attachment[];
    /** Ghost contract (P1-100): nothing in src populates `sources`. */
    sources?: unknown[];
}

export interface Conversation {
    id: string;
    title: string;
    /**
     * Normalized timestamp in milliseconds (SSoT).
     */
    timestamp: number;
    /**
     * Provenance of `timestamp`/`updatedAt`: which writer last established the
     * value. 'scan' = our own list-RPC scan (batchexecute); 'sniff' = page's
     * own list response captured by the hook (network-list); 'unknown' = legacy
     * records or writers that carry no timestamp. Incremental early-exit only
     * counts 'scan' records: a sniffed timestamp proves the item is unchanged,
     * not that the tail behind it was ever scanned.
     */
    timestampSource?: 'scan' | 'sniff' | 'unknown';
    updatedAt?: number | string;
    createdAt?: number | string;
    chatTime?: number | string;
    lastSeen?: number | string;
    source?: string;
    titleSource?: TitleSource | string;
    titles?: TitleSources;
    messages?: ChatMessage[];
    turns?: Turn[];
    accountSlot?: string;
    isTakeoutOnly?: boolean;
    hitGoogleLimit?: boolean;
    url?: string;
    /**
     * P1-091: real runtime fields previously hidden behind an `any` index
     * signature. Written by takeoutHtmlParser / parseDetail / chatFormatter /
     * exportOrchestrator.
     */
    attachmentCount?: number;
    messageCount?: number;
    /** Takeout parser writes a duplicate of url here. */
    href?: string;
    /** Takeout parser flag: the chat had an explicit user prompt (not just media). */
    hasExplicitPrompt?: boolean;
}
