/** Passive persistence only. Business decisions and browser IPC belong to callers. */
export { getAccount, listAccounts, insertAccountIfAbsent, putAccount } from './accountRegistryStore.js';
export { getIndex, listIndexes, putIndexes, deleteIndex, getDetail, putDetail, deleteDetail, updateIndexesAtomically, updateConversationAtomically, deleteStoredConversation } from './conversationStore.js';
export { getCoverage, putCoverage, deleteCoverage } from './scanCoverageStore.js';
export { getExportRecord, listExportRecords, putExportRecord, deleteExportRecord } from './exportRecordStore.js';
export { getStoredSettings, patchStoredSettings } from './settingsStore.js';
export { getDirectoryHandle, setDirectoryHandle, clearDirectoryHandle } from './idbHandleStore.js';
export { clearStoredAccountData } from './accountDataStore.js';
