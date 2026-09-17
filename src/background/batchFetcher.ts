// src/background/batchFetcher.ts - Batch chat fetching, 429 rate limit backoff, and progress broadcast

import { TabService } from '../core/utils/tabService.js';
import { isRateLimited, calculateBackoff } from '../core/engine/export/rateLimiter.js';
import { interruptibleSleep } from '../core/api/client/retryPolicy.js';
import { isSlotAborted } from './abortManager.js';
import { startKeepAlive } from './keepAlive.js';

// Tab communication service helper (delegates to TabService: handles 'Receiving end does not exist' and hints '刷新 gemini.google.com')
export const sendToGeminiTab = (msg: any, slot?: string, timeoutMs?: number): Promise<any> =>
    TabService.sendToGeminiTab(msg, slot, timeoutMs);

export const getGeminiTab = (slot?: string): Promise<any> =>
    TabService.getGeminiTab(slot);

async function sendToGeminiTabCancellable(msg: any, slot: string): Promise<any> {
    let settled = false;
    const abortWait = (async () => {
        while (!settled && !isSlotAborted(slot)) {
            await new Promise(r => setTimeout(r, 50));
        }
        return { __slotAborted: !settled };
    })();
    try {
        return await Promise.race([sendToGeminiTab(msg, slot), abortWait]);
    } finally {
        settled = true;
    }
}

export async function fetchBatch(
    list: any,
    format?: string,
    skipExported?: boolean,
    portSendResponse?: (response: any) => void,
    globalOffset: number = 0,
    globalTotal: number = 0,
    accountSlot: string = 'u0'
): Promise<void> {
    const stopKeepAlive = startKeepAlive();
    try {
        const slot = accountSlot || 'u0';
        if (!list || !list.length) {
            if (portSendResponse) portSendResponse({ success: true, results: [], skipped: 0 });
            return;
        }
        const tab = await getGeminiTab(slot);
        if (!tab) {
            if (portSendResponse) {
                portSendResponse({
                    success: false,
                    error: '请先打开 gemini.google.com，保持登录状态'
                });
            }
            return;
        }

        const totalCount = globalTotal || list.length;
        const results: any[] = [];
        let done = 0;

        for (const item of list) {
            if (isSlotAborted(slot)) break;
            const cid = item.id || item;
            try {
                let res: any = null;
                let retryCount = 0;
                const maxRetries = 3;

                while (retryCount <= maxRetries && !isSlotAborted(slot)) {
                    res = await sendToGeminiTabCancellable({
                        action: 'getConversationDetail',
                        conversationId: cid
                    }, slot);
                    if ((res as any)?.__slotAborted) { res = null; break; }

                    const isRateLimit = isRateLimited(res);

                    if (isRateLimit && retryCount < maxRetries) {
                        const rawAfter = (res as any)?.retryAfterMs;
                        const retryAfterMs = (typeof rawAfter === "number" && rawAfter > 0)
                            ? Math.min(rawAfter, 30000)
                            : undefined;
                        const delayMs = calculateBackoff(retryCount, { retryAfterMs });
                        console.warn(`[Gemini Exporter Background] fetchBatch 429 rate limit for ${cid}, backoff ${delayMs}ms (attempt ${retryCount + 1}/${maxRetries})`);
                        const wasAborted = await interruptibleSleep(delayMs, undefined, () => isSlotAborted(slot));
                        if (wasAborted) break;
                        retryCount++;
                        continue;
                    }
                    break;
                }

                if (isSlotAborted(slot)) break;

                if (res && res.success) {
                    const chat = res.data || res.chat || res;
                    chat.id = cid;
                    results.push(chat);
                } else {
                    results.push({
                        id: cid,
                        title: item.title,
                        url: item.url || `https://gemini.google.com/app/${cid}`,
                        error: res?.error || '抓取失败',
                        messages: [],
                        _empty: true,
                        _debug: res?._debug || null,
                        _raw: res?._raw || null
                    });
                }
            } catch (e: any) {
                results.push({
                    id: cid,
                    title: item.title,
                    url: item.url || `https://gemini.google.com/app/${cid}`,
                    error: e?.message || '抓取异常',
                    messages: [],
                    _empty: true,
                    _debug: e?.stack || null,
                    _raw: null
                });
            }
            done++;
            chrome.runtime.sendMessage({
                action: 'exportProgress',
                done: globalOffset + done,
                total: totalCount,
                title: item.title,
                id: cid
            }).catch(() => {});
        }

        const wasAborted = isSlotAborted(slot);
        if (portSendResponse) {
            portSendResponse({
                success: !wasAborted,
                aborted: wasAborted,
                results,
                skipped: 0,
                ...(wasAborted ? { error: 'aborted' } : {})
            });
        }
    } finally {
        stopKeepAlive();
    }
}
