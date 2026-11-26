import { isRecord } from '../../shared/utils/typeGuards.js';

const origin = 'http://127.0.0.1:43191';

export async function pickDriveFolder(token: string, signal: AbortSignal, frame: HTMLIFrameElement, dialog: HTMLDialogElement): Promise<string | undefined> {
    const config = await fetch(chrome.runtime.getURL('drive-picker.json'), { signal });
    if (!config.ok) throw new Error('Drive Picker test host is not configured');
    const pairing: unknown = await config.json();
    if (!isRecord(pairing) || typeof pairing.proof !== 'string' || !pairing.proof) throw new Error('Invalid Picker configuration');
    const proof = pairing.proof;
    signal.throwIfAborted();
    return await new Promise<string | undefined>((resolve, reject) => {
        let port: MessagePort | undefined;
        if (!dialog.open) { resolve(undefined); return; }
        function loaded() { frame.contentWindow?.postMessage('picker-ready', origin); }
        function closed() { finish(); }
        const timeout = window.setTimeout(() => finish(undefined, 'Drive Picker did not connect'), 15000);
        function finish(id?: string, error?: string) {
            clearTimeout(timeout);
            frame.removeEventListener('load', loaded);
            dialog.removeEventListener('close', closed);
            window.removeEventListener('message', ready);
            signal.removeEventListener('abort', abort);
            port?.close();
            if (error) reject(new Error(error));
            else resolve(id);
        }
        function abort() { finish(undefined, 'Drive Picker closed'); }
        function ready(event: MessageEvent<unknown>) {
            if (port || event.origin !== origin || event.source !== frame.contentWindow || event.ports.length !== 1) return;
            if (!isRecord(event.data) || event.data.proof !== proof) {
                finish(undefined, 'Drive Picker host does not match this test installation');
                return;
            }
            port = event.ports[0];
            clearTimeout(timeout);
            port.onmessage = ({ data }: MessageEvent<unknown>) => {
                if (isRecord(data) && data.action === 'cancel') finish();
                else if (isRecord(data) && data.action === 'pick' && typeof data.id === 'string' && /^[\w-]+$/.test(data.id)) finish(data.id);
                else finish(undefined, 'Google Drive Picker failed');
            };
            port.postMessage({ token });
        }
        window.addEventListener('message', ready);
        signal.addEventListener('abort', abort, { once: true });
        frame.addEventListener('load', loaded);
        dialog.addEventListener('close', closed);
        frame.src = origin + '/picker';
    });
}
