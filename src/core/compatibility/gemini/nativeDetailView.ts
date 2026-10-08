import type { GeminiRpcParseResult } from '../../parsers/gemini/rpc/parseConversation.js';
import type { DetailParseResult, ParserMessage } from '../../api/client/detailTypes.js';
import { createParsedConversationView } from '../record/projectDomainRecord.js';

/** Existing application envelope is a one-way view of the already parsed Domain. */
export function createNativeDetailView(parsed: GeminiRpcParseResult): DetailParseResult {
    const view = createParsedConversationView(parsed);
    return { ...view, messages: view.messages as ParserMessage[], titleSource: view.titleSource as DetailParseResult['titleSource'], titles: view.titles ?? {}, url: view.url ?? '',
        chatTime: view.timestamp, nextPageToken: parsed.transport.nextPageToken,
        attachmentCount: view.attachmentCount ?? 0,
        ...(parsed.transport.turnsRejected !== undefined ? { turnsRejected: parsed.transport.turnsRejected } : {}),
        ...(parsed.transport.schemaDrift ? { schemaDrift: parsed.transport.schemaDrift } : {}),
        ...(parsed.transport.decodedPayload !== undefined ? { _raw: parsed.transport.decodedPayload } : {}),
        ...(parsed.transport.debug !== undefined ? { _debug: parsed.transport.debug } : {}) };
}
