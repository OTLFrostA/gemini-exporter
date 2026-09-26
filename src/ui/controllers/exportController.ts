import type { ExportControllerContract } from '../../types/ui.js';
import ExportEngine from '../../core/engine/exportEngine.js';
import { PdfExporter } from "../../core/export/pdf/pdfExporter.js";
import { ProgressView } from '../views/progressView.js';
import { $, setWorkbenchControlsDisabled } from '../uiCommon.js';
import { normId } from '../../core/utils/pathUtils.js';

let activeEngine: any = null;
let exportRunning = false;

export function estimateMemoryUsage(selected: any[], conversations: any[]): number {
    if (!Array.isArray(selected) || !selected.length) return 0;
    const convMap = new Map<string, any>((conversations || []).map((c: any) => [normId(c?.id), c]));
    let totalAttachments = 0;
    let totalMessages = 0;
    for (const item of selected) {
        const rawId = typeof item === 'string' ? item : item?.id;
        const norm = normId(rawId);
        const conv = (norm ? convMap.get(norm) : null) || (typeof item === 'object' ? item : null);
        if (conv) {
            totalAttachments += (conv.attachmentCount || conv.attachments?.length || 0);
            totalMessages += (conv.messageCount || conv.messages?.length || 0);
        }
    }
    return Math.round((totalAttachments * 1.8) + (totalMessages * 0.02) + (selected.length * 0.05));
}

export function setRunning(running: boolean): void {
    exportRunning = !!running;
    setWorkbenchControlsDisabled(running);
    const btnCancel = $('btnCancel');
    if (btnCancel) btnCancel.style.display = running ? '' : 'none';
    const banner = $('exportSessionBanner');
    if (running && banner) {
        banner.style.display = 'none';
    }
}

export function isRunning(): boolean {
    return exportRunning;
}

export function getActiveEngine(): any {
    return activeEngine;
}

export function abort(): void {
    if (activeEngine) {
        try {
            activeEngine.abort();
        } catch { /* intentional */ }
    }
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: 'cancelExport' }, () => {
                if (chrome.runtime.lastError) {}
            });
        }
    } catch (e) {
        if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:exportController.ts]", e);
    }
    setRunning(false);
    ProgressView.hide();
}


export async function runExport(
    options: any,
    callbacks: any
): Promise<any> {
    setRunning(true);
    try {
        // PDF goes through its own orchestrator (normalize -> IPdfCompiler ->
        // Writer) while reusing the same progress/cancel UI wiring.
        // §15 release gate: the P3 stub compiler is NOT wired in here.
        // PdfExporter throws without a real compiler (or explicit allowStub).
        // Surface that visibly through the existing error channel — never
        // silently "succeed" with a placeholder PDF. P2 injects the real
        // Typst compiler here.
        activeEngine = new ExportEngine();
        if (options && options.format === 'pdf') {
            try {
                activeEngine = new PdfExporter(undefined, { allowStub: false });
            } catch (e: any) {
                const msg = e?.message || String(e);
                const userMsg = `PDF 导出失败: PDF 引擎尚未接入（${msg}）`;
                if (callbacks && typeof callbacks.onLog === 'function') {
                    callbacks.onLog(`[PDF] ${userMsg}`, 'error');
                }
                throw new Error(userMsg);
            }
        }
        const result = await activeEngine.run(options, callbacks);
        return result;
    } finally {
        setRunning(false);
        activeEngine = null;
    }
}

export const ExportController: ExportControllerContract = {
    setRunning,
    isRunning,
    getActiveEngine,
    runExport,
    abort,
    estimateMemoryUsage
};

export default ExportController;
