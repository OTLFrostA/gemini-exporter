export const MESSAGE_ACTIONS = {
    OPEN_OPTIONS: 'openOptions',
    PING: 'ping',
    ENSURE_V2_READY: 'ensureV2Ready',
    DOMAIN_INGEST: 'domainIngest',
    GET_LOCAL_INDEX_COUNT: 'getLocalIndexCount',
    UPDATE_BADGE_POSITION: 'updateBadgePosition',
    RUN_LIVE_SAVE: 'runLiveSave',
    GET_ACCOUNT_CONTEXT: 'getAccountContext',
    ACCOUNT_REGISTRY: 'accountRegistry',
    OPEN_GEMINI_PAGE: 'openGeminiPage',
    RELOAD_GEMINI_TAB: 'reloadGeminiTab',
    GET_FILE_BLOB: 'getFileBlob',
    GET_IMAGE_BLOB: 'getImageBlob',
} as const;

export type MessageAction = typeof MESSAGE_ACTIONS[keyof typeof MESSAGE_ACTIONS];

export interface BaseMessage {
    action: MessageAction;
}
