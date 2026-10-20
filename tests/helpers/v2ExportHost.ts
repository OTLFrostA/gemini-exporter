import type { TestContext } from 'node:test';
import { indexStorage } from './indexStorage.js';
import { fixtureAccount } from './domainFixture.js';
import { ingestDetail, ingestIndexes } from '../../src/l2/ingestion.js';
import { updateSettings } from '../../src/application/settings/index.js';
import type { ExportRequest } from '../../src/application/export/types.js';

const account = fixtureAccount('gemini');

/** Only the extension host is faked: L2, L3a, Application, L3b and L4 remain real. */
export function v2ExportHost(t: TestContext, onClick: () => void = () => {}) {
    const storage = indexStorage();
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const originalObjectUrl = URL.createObjectURL;
    const blobs: Blob[] = [];
    const filenames: string[] = [];
    let clicks = 0;

    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        createElement: (tag: string) => {
            if (tag !== 'a') throw new Error('Unexpected document element: ' + tag);
            const anchor = { href: '', download: '', remove() {}, click() {
                clicks++;
                filenames.push(anchor.download);
                onClick();
            } };
            return anchor;
        },
        body: { appendChild() {} },
    } });
    Object.defineProperty(globalThis, 'location', {
        configurable: true, value: { hostname: 'example.test', protocol: 'https:' },
    });
    URL.createObjectURL = ((blob: Blob) => {
        blobs.push(blob);
        return originalObjectUrl.call(URL, blob);
    }) as typeof URL.createObjectURL;
    t.after(() => {
        URL.createObjectURL = originalObjectUrl;
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else Reflect.deleteProperty(globalThis, 'document');
        if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
        else Reflect.deleteProperty(globalThis, 'location');
        storage.restore();
    });
    return { blobs, filenames, clicks: () => clicks, failStorage: storage.fail };
}

export function exportKey(conversationId: string) {
    return { accountId: account.id, conversationId };
}
export function exportRequest(ids: readonly string[], options: Partial<ExportRequest> = {}): ExportRequest {
    return { keys: ids.map(exportKey), format: 'markdown',
        delivery: 'browserDownload', includeAssets: false, skipUnchanged: false, ...options };
}
export async function seedExportConversation(conversationId: string, savedAt = 100): Promise<void> {
    await ingestDetail(account.id, conversationId, {
        savedAt, quality: { status: 'complete' }, assets: [],
        messages: [
            { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Prompt for ' + conversationId }] }] },
            { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Answer for ' + conversationId }] }] },
        ],
    }, { title: 'Conversation ' + conversationId, titleSource: 'provider', updatedAt: savedAt });
    await updateSettings({ language: 'en' });
}
export async function seedExportIndexOnly(conversationId: string): Promise<void> {
    await ingestIndexes(account.id, [{ conversationId, fields: {
        title: 'Unavailable ' + conversationId, titleSource: 'provider', updatedAt: 100,
    } }]);
}
