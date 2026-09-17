// src/core/engine/exportEngine.ts - Re-export facade delegating to ExportOrchestrator
export type {
    ExportOptions,
    ExportCallbacks,
    ExportResult
} from "./export/exportOrchestrator.js";

import {
    ExportOrchestrator,
    AsyncQueue,
    ensureSubDir,
    sanitizeFileName,
    sanitizeZipPath,
    getExtensionVersion,
    type ExportOrchestratorModule
} from "./export/exportOrchestrator.js";

export type ExportEngineModule = ExportOrchestratorModule;

export const ExportEngine = ExportOrchestrator;

export {
    ExportOrchestrator,
    AsyncQueue,
    ensureSubDir,
    sanitizeFileName,
    sanitizeZipPath,
    getExtensionVersion
};

export const ExportEngineModule: ExportEngineModule = {
    ExportOrchestrator,
    AsyncQueue,
    ensureSubDir,
    sanitizeFileName,
    sanitizeZipPath,
    getExtensionVersion
};

export default ExportOrchestrator;
