/** Compatibility names for the historical export input. New code uses the neutral record boundary. */
export type {
    ConversationRecordAttachment as GeminiNormalizationAttachment,
    ConversationRecordMessage as GeminiNormalizationMessage,
    ConversationRecordTurn as GeminiNormalizationTurn,
    ConversationRecordInput as GeminiNormalizationInput,
} from '../record/conversationRecord.js';
