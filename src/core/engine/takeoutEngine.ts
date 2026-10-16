// Stable public facade for Takeout operations.
//
// Design intent — kept deliberately, this is not an empty shell:
// - This module is the public application entry point for Takeout APIs.
// - It aggregates import orchestration and the offline resource cache into one
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
    __accountTakeouts,
    type TakeoutStore,
    type TakeoutResourceLookup
} from "../resources/takeout/mediaIndex.js";
import {
    parseTakeoutZip,
    type TakeoutParseResult
} from "../imports/takeout/importTakeout.js";

export type { TakeoutStore, TakeoutParseResult, TakeoutResourceLookup };

export interface TakeoutEngineModule {
    getTakeoutOfflineChat: typeof getTakeoutOfflineChat;
    getTakeoutFallbackMedia: typeof getTakeoutFallbackMedia;
    getTakeoutMediaForChat: typeof getTakeoutMediaForChat;
    extractC2PATimestamp: typeof extractC2PATimestamp;
    parseTakeoutZip: typeof parseTakeoutZip;
    clearTakeoutData: typeof clearTakeoutData;
    getStore: typeof getStore;
    __accountTakeouts: Map<string, TakeoutStore>;
}

export {
    getTakeoutOfflineChat,
    getTakeoutFallbackMedia,
    getTakeoutMediaForChat,
    extractC2PATimestamp,
    parseTakeoutZip,
    clearTakeoutData,
    getStore,
    __accountTakeouts
};

export const TakeoutEngine: TakeoutEngineModule = {
    getTakeoutOfflineChat,
    getTakeoutFallbackMedia,
    getTakeoutMediaForChat,
    extractC2PATimestamp,
    parseTakeoutZip,
    clearTakeoutData,
    getStore,
    __accountTakeouts
};

export default TakeoutEngine;
