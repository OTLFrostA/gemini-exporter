interface GeminiCredentials {
    at?: string;
    bl?: string;
    sid?: string;
    accountSlot?: string;
    lastUsed?: number;
    url?: string;
}

/** The only capability ContentContext consumes from its active client. */
export interface ActiveClientContract {
    abort?: () => void;
}

/** A content script has a stable Window. Tests can inject a small mirror or null. */
type ContentWindowMirror = Pick<Window,
    '__gemExporterContentContext' | '__gemExporterAborted' | '__gemExporterActiveClient'
    | '__gemExporterInjected' | '__gemExporterDevMode'
    | '__gemExporterExtractedAt' | '__gemExporterExtractedBl' | '__geminiAt'
>;

/** The event name selects the exact listener argument tuple. */
interface ContentEventArgs {
    credentials: [GeminiCredentials | null];
    abort: [];
    langChange: [string];
    devModeChange: [boolean];
}

type ContentEvent = keyof ContentEventArgs;
type ContentListeners = { [K in ContentEvent]: Set<(...args: ContentEventArgs[K]) => void> };


export class ContentContext {
    private _aborted = false;
    private _cancelledAt = 0;
    private _activeClient: ActiveClientContract | null = null;
    private _credentials: GeminiCredentials | null = null;
    private _devMode = false;
    private _currentLang = 'zh';
    private _injected = false;
    private readonly _listeners: ContentListeners = {
        credentials: new Set(),
        abort: new Set(),
        langChange: new Set(),
        devModeChange: new Set(),
    };

    // Resolve the browser capability once at construction. Runtime methods
    // never need to re-check a global whose availability is fixed per context.
    constructor(private readonly _window: ContentWindowMirror | null = typeof window === 'undefined' ? null : window) {
        this._syncWindowMirrors();
    }

    private _syncWindowMirrors(): void {
        if (!this._devMode || !this._window) return;
        const w = this._window;
        w.__gemExporterContentContext = this;
        w.__gemExporterAborted = this._aborted;
        w.__gemExporterActiveClient = this._activeClient;
        w.__gemExporterInjected = this._injected;
        w.__gemExporterDevMode = this._devMode;
    }

    public isAborted(): boolean {
        return this._aborted;
    }

    public getCancelledAt(): number { return this._cancelledAt; }

    public setAborted(val: boolean): void {
        if (val) this._cancelledAt = Date.now();
        this._aborted = val;
        if (this._devMode && this._window) {
            this._window.__gemExporterAborted = val;
        }
    }

    public abort(): void {
        this.setAborted(true);
        if (this._activeClient && typeof this._activeClient.abort === 'function') {
            try {
                this._activeClient.abort();
            } catch {
                /* intentional: best-effort abort */
            }
        }
        this.emit('abort');
    }

    public getActiveClient(): ActiveClientContract | null {
        return this._activeClient;
    }

    public setActiveClient(client: ActiveClientContract | null): void {
        this._activeClient = client;
        if (this._devMode && this._window) {
            this._window.__gemExporterActiveClient = client;
        }
    }

    public setCredentials(creds: Partial<GeminiCredentials> | null): void {
        if (!creds) {
            this._credentials = null;
        } else {
            this._credentials = { ...(this._credentials || {}), ...creds };
            if (this._devMode && this._credentials.at && this._window) {
                this._window.__gemExporterExtractedAt = this._credentials.at;
                this._window.__geminiAt = this._credentials.at;
            }
            if (this._devMode && this._credentials.bl && this._window) {
                this._window.__gemExporterExtractedBl = this._credentials.bl;
            }
        }
        this.emit('credentials', this._credentials);
    }

    public isDevMode(): boolean {
        return this._devMode;
    }

    public setDevMode(val: boolean): void {
        this._devMode = val;
        if (this._window) {
            this._window.__gemExporterDevMode = val;
            if (val) this._syncWindowMirrors();
        }
        this.emit('devModeChange', val);
    }

    public getLanguage(): string {
        return this._currentLang;
    }

    public setLanguage(lang: string): void {
        this._currentLang = lang || 'zh';
        this.emit('langChange', this._currentLang);
    }

    public isZh(): boolean {
        return (this._currentLang || '').toLowerCase().startsWith('zh');
    }

    public isInjected(): boolean {
        return this._injected;
    }

    public setInjected(val: boolean): void {
        this._injected = val;
        if (this._devMode && this._window) {
            this._window.__gemExporterInjected = val;
        }
    }

    public on<K extends ContentEvent>(event: K, listener: (...args: ContentEventArgs[K]) => void): () => void {
        const set = this._listeners[event];
        set.add(listener);
        return () => { set.delete(listener); };
    }

    public emit<K extends ContentEvent>(event: K, ...args: ContentEventArgs[K]): void {
        const set = this._listeners[event];
        if (!set) return;
        for (const listener of Array.from(set)) {
            try {
                listener(...args);
            } catch (err) {
                if (this._devMode) {
                    console.debug(`[ContentContext] error in listener for ${event}:`, err);
                }
            }
        }
    }
}

export const contentContext = new ContentContext();
