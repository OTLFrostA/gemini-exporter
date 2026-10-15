/** Historical fixture grammar, never an application index. */
import type { ChatMessage, Turn, TitleSource, TitleSources } from '../../src/types/conversation.js';
export interface HistoricalConversation {
    id: string;
    title: string;
    timestamp: number | null;
    updatedAt?: number | string | null;
    createdAt?: number | string | null;
    chatTime?: number | string;
    lastSeen?: number | string;
    source?: string;
    titleSource?: TitleSource | string;
    titles?: TitleSources;
    messages?: ChatMessage[];
    turns?: Turn[];
    accountSlot?: string;
    isTakeoutOnly?: boolean;
    cloudAvailability?: 'deleted' | 'unlisted';
    hitGoogleLimit?: boolean;
    url?: string;
    attachmentCount?: number;
    messageCount?: number;
    href?: string;
    sidebarIndex?: number;
    hasExplicitPrompt?: boolean;
}
