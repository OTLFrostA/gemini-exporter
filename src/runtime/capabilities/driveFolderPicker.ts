import { isRecord } from '../../shared/utils/typeGuards.js';

const origin = 'http://127.0.0.1:43191';

// The test package pairs one local Picker host with this unpacked extension.
// The web page owns the transferred port, so navigation cannot inherit a token.
export async function pickDriveFolder(token: string, signal: AbortSignal): Promise<string | undefined> {
    const popup = window.open(origin + '/picker', '_blank', 'popup,width=900,height=700');
    if (!popup) throw new Error('Allow the Google Drive folder picker window');
    try {
        const config = await fetch(chrome.runtime.getURL('drive-picker.json'), { signal });
        if (!config.ok) throw new Error('Drive Picker test host is not configured');
        const pairing: unknown = await config.json();
        if (!isRecord(pairing) || typeof pairing.proof !== 'string' || !pairing.proof) throw new Error('Invalid Picker configuration');
        const proof = pairing.proof;
        signal.throwIfAborted();
        return await new Promise<string | undefined>((resolve, reject) => {
            let port: MessagePort | undefined;
            const timer = window.setInterval(() => {
                if (popup.closed) finish();
                else if (!port) popup.postMessage('picker-ready', origin);
            }, 200);
            const timeout = window.setTimeout(() => finish(undefined, 'Drive Picker did not connect'), 15000);
            function finish(id?: string, error?: string) {
                clearTimeout(timeout);
                clearInterval(timer);
                window.removeEventListener('message', ready);
                signal.removeEventListener('abort', abort);
                port?.close();
                if (error) reject(new Error(error));
                else resolve(id);
            }
            function abort() { finish(undefined, 'Drive Picker closed'); }
            function ready(event: MessageEvent<unknown>) {
                if (port || event.origin !== origin || event.source !== popup || event.ports.length !== 1) return;
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
            // The popup may finish loading before the local configuration fetch.
            popup.postMessage('picker-ready', origin);
        });
    } finally { popup.close(); }
}
