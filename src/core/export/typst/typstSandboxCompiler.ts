/**
 * src/core/export/typst/typstSandboxCompiler.ts
 *
 * TypstSandboxCompiler: IPdfCompiler backed by the real Typst WASM compiler
 * running in the MV3 sandbox compile container
 * (src/ui/sandbox/typst-compile.html).
 *
 * Pipeline per compile():
 *  1. canonical bundle -> TypstConversationRenderPayload via P1a's
 *     toTypstPayload (user text travels as JSON data only; Typst source is
 *     never built from user text);
 *  2. MATH-table verification of the bundled fonts at load time. When no
 *     loaded font provides a MATH table, converted math (`typst` fields) is
 *     stripped from the payload so the templates degrade to the visible
 *     LaTeX-source note instead of hard-failing the compile, and a
 *     diagnostic is emitted (theme.typ typography contract);
 *  3. image asset bytes resolved through context.assets and mounted as
 *     Typst shadow files; anything unresolvable becomes a diagnostic,
 *     never a silent hole;
 *  4. payload JSON + binaries + fonts cross into the sandbox via
 *     postMessage with transferable ArrayBuffers; the compiled PDF comes
 *     back the same way.
 *
 * Cancellation: an aborted context.signal rejects the in-flight compile
 * with a DOMException named 'AbortError' and notifies the sandbox; the
 * sandbox drops the job at the next stage boundary.
 *
 * The sandbox frame (and its one-time WASM init / font install) is created
 * lazily on first compile and reused across compiles. Compiles are
 * serialized: the Typst compiler keeps mutable per-job state, so
 * interleaving two compiles would corrupt both.
 */

import type { Asset } from '../canonical/assets.js';
import type {
    RenderContext,
    RenderDiagnostic,
    TypstRenderPayload,
} from '../canonical/rendering.js';
import type { IPdfCompiler, PdfCompileResult } from '../pdf/pdfCompiler.js';

import {
    BUNDLED_FONT_PATHS,
    HOST_TO_SANDBOX,
    SANDBOX_OPAQUE_ORIGIN,
    SANDBOX_PAGE_PATH,
    SANDBOX_TO_HOST,
    TYPST_WASM_PATH,
    checkMessageSource,
    newJobId,
    parseProtocolMessage,
    SANDBOX_MESSAGE_TYPES,
} from './sandboxProtocol.js';
import {
    toTypstPayload,
    type TypstBlockNode,
    type TypstConversationRenderPayload,
    type TypstInlineNode,
    type TypstPayloadOptions,
} from './payload.js';

/** PDF magic, checked on every compiled result before it leaves this class. */
const PDF_MAGIC = '%PDF-';

/**
 * Abstraction over the hidden sandbox iframe so unit tests can drive the
 * protocol without a DOM. The production implementation lives in
 * BrowserSandboxHost below.
 */
export interface SandboxFrame {
    /** The iframe's contentWindow; identity-checked against message events. */
    readonly contentWindow: unknown;
    postToSandbox(message: Record<string, unknown>, transfer?: Transferable[]): void;
    onMessage(handler: (event: { source: unknown; origin: string; data: unknown }) => void): () => void;
    destroy(): void;
}

export interface SandboxHost {
    /** Absolute extension URL of the sandbox page. */
    pageUrl(): string;
    /** Absolute extension URL for an extension-relative asset path. */
    assetUrl(relativePath: string): string;
    fetchBytes(url: string): Promise<Uint8Array>;
    createFrame(url: string): SandboxFrame;
}

/**
 * Production host: hidden iframe in the current extension page,
 * chrome.runtime URLs, window.fetch. Requires a DOM + extension context.
 */
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
        // The manifest sandbox.pages entry + sandbox CSP already confine
        // this page; no extra iframe sandbox attribute is needed or wanted
        // (it would only further restrict the already-sandboxed page).
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

export interface TypstSandboxPayloadOptions {
    /**
     * Maps a canonical asset to the virtual path mounted into Typst.
     * Defaults to `assets/<assetId><ext>`. The same function is forwarded
     * to P1a's toTypstPayload and reused here to map payload image paths
     * back to canonical asset ids for byte resolution.
     */
    assetPath?: (asset: Asset) => string | undefined;
    /**
     * Controlled math conversion: source LaTeX -> trusted Typst math.
     * See TypstPayloadOptions.convertMath.
     */
    convertMath?: (source: string, notation: string, display: boolean) => string | undefined;
    /** Explicit branch leaf override, see TypstPayloadOptions.leafMessageId. */
    leafMessageId?: string;
}

function defaultAssetPath(asset: Asset): string {
    const name = asset.name ?? '';
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 && dot < name.length - 1 ? name.slice(dot) : '';
    return `assets/${asset.id}${ext}`;
}

export interface TypstSandboxCompilerOptions {
    /** Payload adapter options, forwarded to P1a's toTypstPayload. */
    payloadOptions?: TypstSandboxPayloadOptions;
    /** DI hook for tests; defaults to BrowserSandboxHost. */
    host?: SandboxHost;
    wasmPath?: string;
    fontPaths?: readonly string[];
    initTimeoutMs?: number;
    compileTimeoutMs?: number;
}

interface PendingJob {
    resolve: (value: PendingResult) => void;
    reject: (error: unknown) => void;
    onProgress?: (stage: string, current: number, total: number) => void;
    timer: ReturnType<typeof setTimeout>;
}

type PendingResult =
    | { kind: 'inited'; initMs?: number }
    | { kind: 'compiled'; pdf: ArrayBuffer | null; diagnostics: Array<{ severity: string; message: string }>; fontsMissingMath?: number[] };

/**
 * True when the font's sfnt table directory contains a 'MATH' table.
 * Pure function over bytes; no font parsing dependency.
 */
export function fontHasMathTable(bytes: Uint8Array): boolean {
    if (bytes.length < 12) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const numTables = view.getUint16(4);
    if (bytes.length < 12 + numTables * 16) return false;
    for (let i = 0; i < numTables; i += 1) {
        // 'MATH' == 0x4D415448
        if (view.getUint32(12 + i * 16) === 0x4d415448) return true;
    }
    return false;
}

/**
 * Remove converted Typst math (`typst` fields) from a render payload so the
 * templates fall back to the visible LaTeX-source note. Used when no loaded
 * font provides a MATH table; without this the compile hard-fails.
 * Mutates the (freshly built) payload in place; returns the stripped count.
 */
export function stripConvertedMath(doc: TypstConversationRenderPayload): number {
    let stripped = 0;
    const stripInline = (nodes: TypstInlineNode[]): void => {
        for (const node of nodes) {
            if ((node.type === 'strong' || node.type === 'emphasis' || node.type === 'link') && 'children' in node) {
                stripInline(node.children);
            } else if (node.type === 'inlineMath' && 'typst' in node && node.typst !== undefined) {
                delete (node as { typst?: string }).typst;
                stripped += 1;
            }
        }
    };
    const stripBlock = (block: TypstBlockNode): void => {
        switch (block.type) {
            case 'paragraph':
            case 'heading':
            case 'quote':
            case 'note':
                stripInline(block.children);
                break;
            case 'list':
                for (const item of block.items) stripInline(item.children);
                break;
            case 'table':
                for (const row of block.headers) {
                    stripInline(row);
                }
                for (const row of block.rows) {
                    for (const cell of row) stripInline(cell);
                }
                break;
            case 'math':
                if ('typst' in block && block.typst !== undefined) {
                    delete (block as { typst?: string }).typst;
                    stripped += 1;
                }
                break;
            default:
                break;
        }
    };
    for (const message of doc.messages) {
        for (const block of message.blocks) stripBlock(block);
    }
    return stripped;
}

function abortError(message: string): DOMException {
    return new DOMException(message, 'AbortError');
}

/**
 * Collect every image asset path referenced by the render payload
 * (block images + image attachments).
 */
function collectImagePaths(doc: TypstConversationRenderPayload): Set<string> {
    const paths = new Set<string>();
    const visitInline = (nodes: TypstInlineNode[]): void => {
        for (const node of nodes) {
            if (node.type === 'image') {
                // Inline images are first-class transport nodes (#562);
                // their bytes must be mounted or the template's image()
                // call fails the compile.
                paths.add(node.asset);
            } else if ((node.type === 'strong' || node.type === 'emphasis' || node.type === 'link') && 'children' in node) {
                visitInline(node.children);
            }
        }
    };
    for (const message of doc.messages) {
        for (const attachment of message.attachments ?? []) {
            if (attachment.type === 'image') paths.add(attachment.asset);
        }
        for (const block of message.blocks) {
            if (block.type === 'image') {
                paths.add(block.asset);
            } else if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' || block.type === 'note') {
                visitInline(block.children);
            } else if (block.type === 'list') {
                for (const item of block.items) visitInline(item.children);
            } else if (block.type === 'table') {
                for (const row of block.headers) visitInline(row);
                for (const row of block.rows) {
                    for (const cell of row) visitInline(cell);
                }
            }
        }
    }
    return paths;
}

export class TypstSandboxCompiler implements IPdfCompiler {
    readonly name = 'typst-wasm-sandbox';

    private readonly payloadOptions: TypstPayloadOptions;
    private readonly host: SandboxHost;
    private readonly wasmPath: string;
    private readonly fontPaths: readonly string[];
    private readonly initTimeoutMs: number;
    private readonly compileTimeoutMs: number;

    private frame: SandboxFrame | null = null;
    private detachListener: (() => void) | null = null;
    private readonly pending = new Map<string, PendingJob>();
    private readyPromise: Promise<void> | null = null;
    private initPromise: Promise<void> | null = null;
    private fontsInstalled = false;
    private fontBytes: Uint8Array[] | null = null;
    private mathFontAvailable: boolean | null = null;
    /** Serializes compiles: the WASM compiler keeps mutable per-job state. */
    private compileQueue: Promise<void> = Promise.resolve();

    constructor(options: TypstSandboxCompilerOptions = {}) {
        const userPayloadOptions = options.payloadOptions ?? {};
        this.payloadOptions = {
            assetPath: userPayloadOptions.assetPath ?? defaultAssetPath,
            convertMath: userPayloadOptions.convertMath,
            leafMessageId: userPayloadOptions.leafMessageId,
        };
        this.host = options.host ?? new BrowserSandboxHost();
        this.wasmPath = options.wasmPath ?? TYPST_WASM_PATH;
        this.fontPaths = options.fontPaths ?? BUNDLED_FONT_PATHS;
        this.initTimeoutMs = options.initTimeoutMs ?? 120_000;
        this.compileTimeoutMs = options.compileTimeoutMs ?? 300_000;
    }

    /** Tear down the sandbox frame. Safe to call multiple times. */
    dispose(): void {
        this.detachListener?.();
        this.detachListener = null;
        for (const [, job] of this.pending) {
            clearTimeout(job.timer);
            job.reject(abortError('Typst sandbox compiler was disposed'));
        }
        this.pending.clear();
        this.frame?.destroy();
        this.frame = null;
        this.readyPromise = null;
        this.initPromise = null;
        this.fontsInstalled = false;
        this.fontBytes = null;
        this.mathFontAvailable = null;
    }

    async compile(payload: TypstRenderPayload, context: RenderContext): Promise<PdfCompileResult> {
        // Serialize: never interleave two compiles on one WASM instance.
        const run = this.compileQueue.then(() => this.compileOne(payload, context));
        // Keep the queue alive even if this compile rejects.
        this.compileQueue = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    private async compileOne(payload: TypstRenderPayload, context: RenderContext): Promise<PdfCompileResult> {
        context.signal.throwIfAborted();

        const diagnostics: RenderDiagnostic[] = [];

        // 1. Canonical bundle -> Typst JSON payload (P1a adapter), or reuse the
        // D7 S3 stage's prebuilt doc (single conversion; S3 already captured
        // the adapter diagnostics in its own stage channel).
        let doc: TypstConversationRenderPayload;
        if (payload.prebuiltDoc) {
            doc = payload.prebuiltDoc;
        } else {
            const { payload: built, diagnostics: adapterDiagnostics } = toTypstPayload(
                payload.bundle,
                this.payloadOptions,
            );
            doc = built;
            for (const d of adapterDiagnostics) {
                diagnostics.push({ severity: d.severity, code: d.code, message: d.message, path: d.path });
            }
        }
        context.reportProgress('typst-payload', 1, 4);
        context.signal.throwIfAborted();

        // 2. Sandbox ready + WASM init (once) + bundled fonts (once).
        await this.ensureInitialized(context.signal);
        context.reportProgress('typst-init', 2, 4);
        context.signal.throwIfAborted();

        // Load the bundled font bytes now: the MATH-table gate below needs
        // the verification result before the payload JSON is finalized.
        const fonts = this.fontsInstalled ? [] : await this.loadFontBytes();

        // 3. MATH-table gate: without a MATH font, converted math must be
        // stripped so templates degrade to the LaTeX note (theme.typ contract).
        if (this.mathFontAvailable === false) {
            const stripped = stripConvertedMath(doc);
            diagnostics.push({
                severity: 'warning',
                code: 'TYPST_MATH_TABLE_MISSING',
                message:
                    `No bundled font provides an OpenType MATH table; stripped ${stripped} ` +
                    `converted math node(s) to the visible LaTeX-source fallback instead of failing the compile.`,
            });
        }

        // 4. Resolve image bytes through context.assets; mount as shadows.
        const binaries: Array<{ path: string; buf: ArrayBuffer }> = [];
        const transfer: ArrayBuffer[] = [];
        const pathToAssetId = new Map<string, string>();
        if (payload.prebuiltAssetPaths) {
            // D7: the doc's image paths came from S2's pathMap; map back
            // through the same table instead of this.payloadOptions.assetPath.
            for (const [assetId, path] of payload.prebuiltAssetPaths) {
                if (path) pathToAssetId.set(path, assetId);
            }
        } else if (this.payloadOptions.assetPath) {
            for (const asset of payload.bundle.assets) {
                const path = this.payloadOptions.assetPath(asset);
                if (path) pathToAssetId.set(path, asset.id);
            }
        }
        for (const imagePath of collectImagePaths(doc)) {
            context.signal.throwIfAborted();
            const assetId = pathToAssetId.get(imagePath);
            if (!assetId) {
                diagnostics.push({
                    severity: 'warning',
                    code: 'TYPST_ASSET_PATH_UNMAPPED',
                    message: `Image path ${imagePath} could not be mapped back to a canonical asset; the template calls image() on this path, so the compile will fail on the missing file.`,
                });
                continue;
            }
            let resolved: { bytes?: Uint8Array; blob?: Blob } | null = null;
            try {
                resolved = await context.assets.resolve(assetId);
            } catch (error) {
                diagnostics.push({
                    severity: 'warning',
                    code: 'TYPST_ASSET_RESOLVE_FAILED',
                    message: `Image asset ${assetId} failed to resolve (${error instanceof Error ? error.message : String(error)}); the template calls image() on its path, so the compile will fail on the missing file.`,
                });
                continue;
            }
            let bytes = resolved?.bytes;
            if (!bytes && resolved?.blob) {
                bytes = new Uint8Array(await resolved.blob.arrayBuffer());
            }
            if (!bytes || bytes.length === 0) {
                diagnostics.push({
                    severity: 'warning',
                    code: 'TYPST_ASSET_EMPTY',
                    message: `Image asset ${assetId} resolved to no bytes; the template calls image() on its path, so the compile will fail on the missing file.`,
                });
                continue;
            }
            // Copy into a fresh ArrayBuffer so the transfer neuters only our copy.
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            binaries.push({ path: imagePath, buf });
            transfer.push(buf);
        }
        context.reportProgress('typst-assets', 3, 4);
        context.signal.throwIfAborted();

        // 5. Ship the job to the sandbox.
        const payloadText = JSON.stringify(doc);
        const fontBuffers: ArrayBuffer[] = fonts.map((bytes) => {
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            transfer.push(buf);
            return buf;
        });
        const jobId = newJobId();
        const message = {
            type: HOST_TO_SANDBOX.COMPILE,
            jobId,
            files: [{ path: '/payload.json', text: payloadText }],
            binaries,
            fonts: fontBuffers,
        };
        const result = await this.roundTrip(
            jobId,
            message,
            transfer,
            this.compileTimeoutMs,
            context.signal,
            (stage, current, total) => context.reportProgress(`typst-${stage}`, current, total),
        );
        // Font-installed state is driven by the sandbox's FONTS_INSTALLED ACK
        // (see handleHostMessage), not by the compile outcome, so a failed
        // compile never triggers a font resend.
        if (result.kind !== 'compiled') {
            throw new Error(`unexpected sandbox reply for compile job ${jobId}`);
        }
        for (const d of result.diagnostics) {
            diagnostics.push({
                severity: d.severity === 'warning' ? 'warning' : d.severity === 'info' ? 'info' : 'error',
                code: 'TYPST_DIAGNOSTIC',
                message: d.message,
            });
        }
        if (result.fontsMissingMath && result.fontsMissingMath.length > 0) {
            diagnostics.push({
                severity: 'warning',
                code: 'TYPST_FONT_MISSING_MATH_TABLE',
                message: `Sandbox reports ${result.fontsMissingMath.length} bundled font(s) without a MATH table (index ${result.fontsMissingMath.join(',')}).`,
            });
        }
        if (result.pdf === null) {
            throw new Error(
                `Typst compile failed for ${payload.bundle.conversation.key.providerId} conversation ` +
                `${payload.bundle.conversation.key.conversationId}: sandbox returned no PDF bytes`,
            );
        }
        const pdfBytes = new Uint8Array(result.pdf);
        const magic = String.fromCharCode(...pdfBytes.slice(0, 5));
        if (magic !== PDF_MAGIC) {
            throw new Error(
                `Typst compile returned ${pdfBytes.length} bytes that do not start with %PDF-; refusing to treat them as a PDF`,
            );
        }
        context.reportProgress('typst-done', 4, 4);
        return { pdfBytes, diagnostics };
    }

    /** Load (once) and MATH-verify the bundled font bytes. */
    private async loadFontBytes(): Promise<Uint8Array[]> {
        if (this.fontBytes) return this.fontBytes;
        const loaded = await Promise.all(
            this.fontPaths.map((relative) => this.host.fetchBytes(this.host.assetUrl(relative))),
        );
        this.fontBytes = loaded;
        this.mathFontAvailable = loaded.some((bytes) => fontHasMathTable(bytes));
        return loaded;
    }

    /** Create the frame, wait for ready, run WASM init. Idempotent. */
    private ensureInitialized(signal: AbortSignal): Promise<void> {
        if (this.initPromise) return this.initPromise;
        this.initPromise = (async () => {
            const frame = this.host.createFrame(this.host.pageUrl());
            this.frame = frame;
            this.detachListener = frame.onMessage((event) => this.handleHostMessage(event));
            // Wait for the sandbox-ready broadcast.
            await this.readyPromiseOrTimeout(signal);
            // Ship the WASM module bytes; the sandbox inits offline from them.
            const wasm = await this.host.fetchBytes(this.host.assetUrl(this.wasmPath));
            signal.throwIfAborted();
            const wasmBuffer = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer;
            const jobId = newJobId();
            const result = await this.roundTrip(
                jobId,
                { type: HOST_TO_SANDBOX.INIT, jobId, wasm: wasmBuffer },
                [wasmBuffer],
                this.initTimeoutMs,
                signal,
            );
            if (result.kind !== 'inited') {
                throw new Error(`unexpected sandbox reply for init job ${jobId}`);
            }
        })();
        // A failed init must not poison later compiles: allow retry.
        this.initPromise.then(
            () => undefined,
            () => {
                this.initPromise = null;
            },
        );
        return this.initPromise;
    }

    private readyPromiseOrTimeout(signal: AbortSignal): Promise<void> {
        if (!this.readyPromise) {
            this.readyPromise = new Promise<void>((resolve, reject) => {
                const jobId = `__ready__`;
                const timer = setTimeout(() => {
                    this.pending.delete(jobId);
                    reject(new Error(`sandbox page did not signal ready within ${this.initTimeoutMs}ms`));
                }, this.initTimeoutMs);
                const onAbort = () => {
                    clearTimeout(timer);
                    this.pending.delete(jobId);
                    reject(abortError('Typst sandbox init aborted while waiting for ready'));
                };
                if (signal.aborted) {
                    onAbort();
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
                this.pending.set(jobId, {
                    resolve: (result) => {
                        if (result.kind === 'inited') {
                            clearTimeout(timer);
                            signal.removeEventListener('abort', onAbort);
                            this.pending.delete(jobId);
                            resolve();
                        }
                    },
                    reject: (error) => {
                        clearTimeout(timer);
                        signal.removeEventListener('abort', onAbort);
                        this.pending.delete(jobId);
                        reject(error);
                    },
                    timer,
                });
            });
        }
        return this.readyPromise;
    }

    /**
     * Send one request job and await its terminal reply (inited / compiled /
     * error). AbortSignal rejection wins over any late sandbox reply.
     */
    private roundTrip(
        jobId: string,
        message: Record<string, unknown>,
        transfer: ArrayBuffer[],
        timeoutMs: number,
        signal: AbortSignal,
        onProgress?: (stage: string, current: number, total: number) => void,
    ): Promise<PendingResult> {
        const frame = this.frame;
        if (!frame) return Promise.reject(new Error('sandbox frame is not created'));
        return new Promise<PendingResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(jobId);
                reject(new Error(`sandbox job ${jobId} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            const cleanup = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', onAbort);
                this.pending.delete(jobId);
            };
            const onAbort = () => {
                cleanup();
                try {
                    frame.postToSandbox({ type: HOST_TO_SANDBOX.CANCEL, jobId });
                } catch {
                    // The frame may already be gone; the rejection below is what matters.
                }
                reject(abortError('Typst compile aborted'));
            };
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
            this.pending.set(jobId, {
                resolve: (result) => {
                    cleanup();
                    resolve(result);
                },
                reject: (error) => {
                    cleanup();
                    reject(error);
                },
                onProgress,
                timer,
            });
            try {
                frame.postToSandbox(message, transfer);
            } catch (error) {
                cleanup();
                reject(error);
            }
        });
    }

    /** Route one inbound sandbox message to its pending job (or drop it). */
    private handleHostMessage(event: { source: unknown; origin: string; data: unknown }): void {
        const frame = this.frame;
        if (!frame) return;
        if (!checkMessageSource(event, frame.contentWindow, SANDBOX_OPAQUE_ORIGIN)) return;
        const parsed = parseProtocolMessage(event.data, SANDBOX_MESSAGE_TYPES);
        if (!parsed.ok) return;
        const { message } = parsed;
        if (message.type === SANDBOX_TO_HOST.READY) {
            const ready = this.pending.get('__ready__');
            ready?.resolve({ kind: 'inited' });
            return;
        }
        const jobId = message.jobId;
        if (jobId === null) return;
        if (message.type === SANDBOX_TO_HOST.FONTS_INSTALLED) {
            // Fonts are installed in the sandbox exactly once. This ACK is
            // decoupled from the compile outcome: the sandbox sends it right
            // after the font builder finishes, before the document compile
            // runs, so a failed compile no longer causes a font resend on
            // the next compile (re-running the font builder wedges WASM).
            this.fontsInstalled = true;
            return;
        }
        const job = this.pending.get(jobId);
        if (!job) return; // Unknown or already settled: ignore late/duplicate replies.
        const body = message.body;
        if (message.type === SANDBOX_TO_HOST.INITED) {
            job.resolve({ kind: 'inited', initMs: typeof body.initMs === 'number' ? body.initMs : undefined });
        } else if (message.type === SANDBOX_TO_HOST.PROGRESS) {
            job.onProgress?.(
                typeof body.stage === 'string' ? body.stage : 'progress',
                typeof body.current === 'number' ? body.current : 0,
                typeof body.total === 'number' ? body.total : 0,
            );
        } else if (message.type === SANDBOX_TO_HOST.COMPILED) {
            const pdf = body.pdf;
            job.resolve({
                kind: 'compiled',
                pdf: pdf instanceof ArrayBuffer ? pdf : null,
                diagnostics: Array.isArray(body.diagnostics)
                    ? (body.diagnostics as Array<{ severity?: unknown; message?: unknown }>).map((d) => ({
                        severity: typeof d.severity === 'string' ? d.severity : 'error',
                        message: typeof d.message === 'string' ? d.message : String(d.message ?? ''),
                    }))
                    : [],
                fontsMissingMath: Array.isArray(body.fontsMissingMath)
                    ? (body.fontsMissingMath as unknown[]).filter((n): n is number => typeof n === 'number')
                    : undefined,
            });
        } else if (message.type === SANDBOX_TO_HOST.ERROR) {
            const err = body.error as { name?: unknown; message?: unknown } | undefined;
            const name = typeof err?.name === 'string' ? err.name : 'Error';
            const error = new Error(typeof err?.message === 'string' ? err.message : 'sandbox reported an error');
            error.name = name;
            job.reject(error);
        }
    }
}
