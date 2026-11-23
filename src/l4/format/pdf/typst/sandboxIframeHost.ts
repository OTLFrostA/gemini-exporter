import { SANDBOX_PAGE_PATH, type HostSandboxMessage } from './sandboxProtocol.js';

export interface SandboxFrame {
    readonly contentWindow: unknown;
    postToSandbox(message: HostSandboxMessage, transfer?: Transferable[]): void;
    onMessage(handler: (event: { source: unknown; origin: string; data: unknown }) => void): () => void;
    destroy(): void;
}

export interface SandboxHost {
    pageUrl(): string;
    assetUrl(relativePath: string): string;
    fetchBytes(url: string): Promise<Uint8Array>;
    createFrame(url: string): SandboxFrame;
}

export class BrowserSandboxHost implements SandboxHost {
    pageUrl(): string {
        return chrome.runtime.getURL(SANDBOX_PAGE_PATH);
    }

    assetUrl(relativePath: string): string {
        return chrome.runtime.getURL(relativePath);
    }

    async fetchBytes(url: string): Promise<Uint8Array> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`failed to fetch sandbox asset ${url}: HTTP ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
    }

    createFrame(url: string): SandboxFrame {
        const iframe = document.createElement('iframe');
        // Do not set iframe.sandbox: manifest.json sandbox.pages already applies the MV3 sandbox CSP.
        iframe.src = url;
        iframe.style.display = 'none';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.tabIndex = -1;
        document.documentElement.appendChild(iframe);
        return {
            contentWindow: iframe.contentWindow,
            postToSandbox: (message, transfer) => {
                iframe.contentWindow?.postMessage(message, '*', transfer ?? []);
            },
            onMessage: (handler) => {
                const listener = (event: MessageEvent) => handler(event);
                window.addEventListener('message', listener);
                return () => window.removeEventListener('message', listener);
            },
            destroy: () => iframe.remove(),
        };
    }
}
