// Public L1 Takeout input and transient archive-resource facade.
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
    importTakeout,
    type TakeoutParseResult
} from "../imports/takeout/importTakeout.js";

export type { TakeoutStore, TakeoutParseResult, TakeoutResourceLookup };

export interface TakeoutEngineModule {
    getTakeoutOfflineChat: typeof getTakeoutOfflineChat;
    getTakeoutFallbackMedia: typeof getTakeoutFallbackMedia;
    getTakeoutMediaForChat: typeof getTakeoutMediaForChat;
    extractC2PATimestamp: typeof extractC2PATimestamp;
    importTakeout: typeof importTakeout;
    clearTakeoutData: typeof clearTakeoutData;
    getStore: typeof getStore;
    __accountTakeouts: Map<string, TakeoutStore>;
}

export {
    getTakeoutOfflineChat,
    getTakeoutFallbackMedia,
    getTakeoutMediaForChat,
    extractC2PATimestamp,
    importTakeout,
    clearTakeoutData,
    getStore,
    __accountTakeouts
};

export const TakeoutEngine: TakeoutEngineModule = {
    getTakeoutOfflineChat,
    getTakeoutFallbackMedia,
    getTakeoutMediaForChat,
    extractC2PATimestamp,
    importTakeout,
    clearTakeoutData,
    getStore,
    __accountTakeouts
};

export default TakeoutEngine;
