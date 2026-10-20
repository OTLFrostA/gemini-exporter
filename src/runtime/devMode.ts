declare global {
    var __gemExporterDevMode: boolean | undefined;
    var __gemExporterVerboseLog: boolean | undefined;
    var __gemExporterLogAll: boolean | undefined;
}

export function isDevMode(): boolean {
    if (typeof globalThis !== 'undefined' && (globalThis.__gemExporterDevMode || globalThis.__gemExporterVerboseLog || globalThis.__gemExporterLogAll)) return true;
    if (typeof window !== 'undefined' && (window.__gemExporterDevMode || window.__gemExporterVerboseLog || window.__gemExporterLogAll)) return true;
    return false;
}

