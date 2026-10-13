// Stable public facade for Takeout operations.
//
// Design intent — kept deliberately, this is not an empty shell:
// - This module is the SOLE public entry point for Takeout APIs. Nothing imports
//   ./takeout/mediaIndex.js or ./takeout/takeoutParser.js directly.
// - It aggregates two implementation modules (mediaIndex + takeoutParser) into one
//   coherent `TakeoutEngine` namespace, so consumers are insulated from internal
//   file moves.
// - The `TakeoutEngine` namespace object is the identity key of the
//   __resolveModule('TakeoutEngine', …) test seam (see takeoutController.ts,
//   optionsContext.ts, and tests using __setModuleOverride('TakeoutEngine', …)).
//   Deleting this facade would force the seam to be re-keyed and churn
//   2 production + 7 test files for zero behavioral gain.
import {
    getTakeoutOfflineChat,
    getTakeoutFallbackMedia,
    getTakeoutMediaForChat,
    extractC2PATimestamp,
    clearTakeoutData,
    getStore,
    __slotTakeouts,
    type TakeoutStore,
    type TakeoutResourceLookup
} from "../compatibility/takeout/mediaIndex.js";
import {
    parseTakeoutZip,
    type TakeoutParseResult
} from "../compatibility/takeout/takeoutParser.js";

export type { TakeoutStore, TakeoutParseResult, TakeoutResourceLookup };

export interface TakeoutEngineModule {
    getTakeoutOfflineChat: typeof getTakeoutOfflineChat;
    getTakeoutFallbackMedia: typeof getTakeoutFallbackMedia;
    getTakeoutMediaForChat: typeof getTakeoutMediaForChat;
    extractC2PATimestamp: typeof extractC2PATimestamp;
    parseTakeoutZip: typeof parseTakeoutZip;
    clearTakeoutData: typeof clearTakeoutData;
    getStore: typeof getStore;
    __slotTakeouts: Map<string, TakeoutStore>;
}

export {
    getTakeoutOfflineChat,
    getTakeoutFallbackMedia,
    getTakeoutMediaForChat,
    extractC2PATimestamp,
    parseTakeoutZip,
    clearTakeoutData,
    getStore,
    __slotTakeouts
};

export const TakeoutEngine: TakeoutEngineModule = {
    getTakeoutOfflineChat,
    getTakeoutFallbackMedia,
    getTakeoutMediaForChat,
    extractC2PATimestamp,
    parseTakeoutZip,
    clearTakeoutData,
    getStore,
    __slotTakeouts
};

export default TakeoutEngine;
