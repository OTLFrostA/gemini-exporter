import { OperationError } from '../../../../shared/errors/operationError.js';
import { repairUnicodeMaps } from './repairUnicodeMaps.js';
import { PdfResourceError, isAbortError } from '../errors.js';
import { missingResource, type ResourceFailure } from '../../../../shared/resources/resourceResult.js';
import type { Diagnostic as RenderDiagnostic } from '../../../../shared/diagnostics/diagnostic.js';
import type { IPdfCompiler, PdfCompileResult, PdfCompileContext, TypstRenderPayload } from '../pdfCompiler.js';
import { BrowserSandboxHost, type SandboxFrame, type SandboxHost } from './sandboxIframeHost.js';
import { collectImagePaths, fontHasMathTable, stripConvertedMath } from './typstPayloadInspector.js';
export { fontHasMathTable, stripConvertedMath } from './typstPayloadInspector.js';

import {
    BUNDLED_FONT_PATHS,
    HOST_TO_SANDBOX,
    SANDBOX_OPAQUE_ORIGIN,
    SANDBOX_TO_HOST,
    TYPST_WASM_PATH,
    checkMessageSource,
    newJobId,
    parseProtocolMessage,
    readSandboxDiagnostic,
    readSandboxError,
    SANDBOX_MESSAGE_TYPES,
    type HostSandboxMessage,
} from './sandboxProtocol.js';

const PDF_MAGIC = '%PDF-';

export interface TypstSandboxCompilerOptions {
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
    | { kind: 'compiled'; pdf: ArrayBuffer | null; diagnostics: Array<{ severity: string; message: string }> };

function abortError(message: string): DOMException {
    return new DOMException(message, 'AbortError');
}

export class TypstSandboxCompiler implements IPdfCompiler {
    readonly name = 'typst-wasm-sandbox';

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
    private runtimeFontBytes: readonly Uint8Array[] = [];
    private mathFontAvailable: boolean | null = null;
    /** Serializes compiles: the WASM compiler keeps mutable per-job state. */
    private compileQueue: Promise<void> = Promise.resolve();
    // Typst 0.7 retains WASM allocations across documents, including after reset().
    // A fresh iframe releases the entire WASM instance before it reaches its limit.
    private completedCompiles = 0;

    constructor(options: TypstSandboxCompilerOptions = {}) {
        this.host = options.host ?? new BrowserSandboxHost();
        this.wasmPath = options.wasmPath ?? TYPST_WASM_PATH;
        this.fontPaths = options.fontPaths ?? BUNDLED_FONT_PATHS;
        this.initTimeoutMs = options.initTimeoutMs ?? 120_000;
        this.compileTimeoutMs = options.compileTimeoutMs ?? 300_000;
    }

    setRuntimeFonts(fonts: readonly Uint8Array[]): void {
        if (this.fontsInstalled || this.fontBytes !== null) {
            return;
        }
        this.runtimeFontBytes = fonts.slice();
    }

    dispose(): void {
        this.resetSandbox();
        this.fontBytes = null;
        this.runtimeFontBytes = [];
        this.mathFontAvailable = null;
    }

    private resetSandbox(): void {
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
        this.completedCompiles = 0;
    }

    async compile(payload: TypstRenderPayload, context: PdfCompileContext): Promise<PdfCompileResult> {
        const run = this.compileQueue.then(async () => {
            context.signal.throwIfAborted();
            if (this.completedCompiles >= 32) this.resetSandbox();
            for (let attempt = 0; ; attempt++) {
                try {
                    const result = await this.compileOne(payload, context);
                    this.completedCompiles++;
                    if (attempt) result.diagnostics.push({ severity: 'warning', code: 'TYPST_SANDBOX_RECOVERED',
                        message: 'PDF runtime restarted after a WASM fault; this document compiled successfully on retry.' });
                    return result;
                } catch (error) {
                    const fatal = error instanceof Error && (error.name === 'RuntimeError'
                        || /unreachable|memory access out of bounds|recursive use of an object|unsafe aliasing|Parking not supported/i.test(error.message));
                    if (!fatal) throw error;
                    // Never let a poisoned instance turn one failure into a failed batch.
                    this.resetSandbox();
                    if (attempt || context.signal.aborted) throw error;
                }
            }
        });
        this.compileQueue = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    private async compileOne(payload: TypstRenderPayload, context: PdfCompileContext): Promise<PdfCompileResult> {
        context.signal.throwIfAborted();

        const diagnostics: RenderDiagnostic[] = [];

        const doc = payload.document ? structuredClone(payload.document) : undefined;
        if (!doc) {
            throw new Error(
                'TypstSandboxCompiler requires a prebuilt Typst document payload; ' +
                'pass { document, assetPaths } built by PDF Format.',
            );
        }
        context.reportProgress('typst-payload', 1, 4);
        context.signal.throwIfAborted();

        await this.ensureInitialized(context.signal);
        context.reportProgress('typst-init', 2, 4);
        context.signal.throwIfAborted();

        const fonts = this.fontsInstalled ? [] : await this.loadFontBytes();

        if (this.mathFontAvailable === false) {
            const stripped = stripConvertedMath(doc);
            diagnostics.push({
                severity: 'warning',
                code: 'TYPST_MATH_TABLE_MISSING',
                message:
                    `No loaded font provides an OpenType MATH table; stripped ${stripped} ` +
                    `converted math node(s) to the visible LaTeX-source fallback instead of failing the compile.`,
            });
        }

        const resourceFailures: ResourceFailure[] = [];
        const imageBytes = new Map<string, Uint8Array>();
        const binaries: Array<{ path: string; buf: ArrayBuffer }> = [];
        const transfer: ArrayBuffer[] = [];
        const pathToAssetId = new Map<string, string>();
        for (const [assetId, path] of payload.assetPaths) {
            if (path) pathToAssetId.set(path, assetId);
        }
        for (const imagePath of collectImagePaths(doc)) {
            context.signal.throwIfAborted();
            const assetId = pathToAssetId.get(imagePath);
            if (!assetId) {
                diagnostics.push({
                    severity: 'warning',
                    code: 'TYPST_ASSET_PATH_UNMAPPED',
                    message: `Image path ${imagePath} could not be mapped back to a prepared resource; the template calls image() on this path, so the compile will fail on the missing file.`,
                });
                continue;
            }
            let bytes: Uint8Array | undefined;
            try {
                const resolved = await context.assets.resolve(assetId);
                bytes = resolved?.bytes;
                if (!bytes && resolved?.blob) bytes = new Uint8Array(await resolved.blob.arrayBuffer());
            } catch (error) {
                context.signal.throwIfAborted();
                if (isAbortError(error)) throw error;
                resourceFailures.push(missingResource(assetId, `Image resolution failed: ${error instanceof Error ? error.message : String(error)}`, 'TYPST_ASSET_RESOLVE_FAILED'));
                continue;
            }
            if (!bytes?.length) {
                resourceFailures.push(missingResource(assetId, 'Image resolved to no bytes', 'TYPST_ASSET_EMPTY'));
                continue;
            }
            imageBytes.set(imagePath, bytes);
            // Copy into a fresh ArrayBuffer so transferring neuters only our copy.
            const buf = new Uint8Array(bytes).buffer;
            binaries.push({ path: imagePath, buf });
            transfer.push(buf);
        }
        if (resourceFailures.length) throw new PdfResourceError(resourceFailures);
        context.reportProgress('typst-assets', 3, 4);
        context.signal.throwIfAborted();

        const payloadText = JSON.stringify(doc);
        const fontBuffers: ArrayBuffer[] = fonts.map((bytes) => {
            const buf = new Uint8Array(bytes).buffer;
            transfer.push(buf);
            return buf;
        });
        const jobId = newJobId();
        const message: HostSandboxMessage = {
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
        if (result.pdf === null) {
            // Probe only after a failed compile. An isolated image failure identifies the
            // resource precisely; successful images and unrelated compiler errors stay intact.
            for (const [imagePath, bytes] of imageBytes) {
                context.signal.throwIfAborted();
                const probeJobId = newJobId();
                const buf = new Uint8Array(bytes).buffer;
                const probe = await this.roundTrip(probeJobId, {
                    type: HOST_TO_SANDBOX.COMPILE, jobId: probeJobId,
                    files: [{ path: '/main.typ', text: `#image(${JSON.stringify(imagePath)})` }],
                    binaries: [{ path: imagePath, buf }], fonts: [],
                }, [buf], this.compileTimeoutMs, context.signal);
                if (probe.kind === 'compiled' && probe.pdf === null) {
                    const reason = probe.diagnostics.map(d => d.message).join('; ') || 'Image decoder rejected bytes';
                    for (const [assetId, path] of payload.assetPaths) {
                        if (path === imagePath) resourceFailures.push(missingResource(assetId, reason, 'TYPST_ASSET_DECODE_FAILED'));
                    }
                }
            }
            if (resourceFailures.length) throw new PdfResourceError(resourceFailures);
            throw new OperationError('PDF_COMPILE_FAILED',
                `Typst compile failed for ${doc.title}: sandbox returned no PDF bytes; ${result.diagnostics.map(d => d.message).join('; ')}`);
        }
        const pdfBytes = new Uint8Array(result.pdf);
        const magic = String.fromCharCode(...pdfBytes.slice(0, 5));
        if (magic !== PDF_MAGIC) {
            throw new Error(
                `Typst compile returned ${pdfBytes.length} bytes that do not start with %PDF-; refusing to treat them as a PDF`,
            );
        }
        const selectableBytes = /\p{M}/u.test(payloadText) ? await repairUnicodeMaps(pdfBytes) : pdfBytes;
        context.signal.throwIfAborted();
        context.reportProgress('typst-done', 4, 4);
        return { pdfBytes: selectableBytes, diagnostics };
    }

    private async loadFontBytes(): Promise<Uint8Array[]> {
        if (this.fontBytes) return this.fontBytes;
        const bundled = await Promise.all(
            this.fontPaths.map((relative) => this.host.fetchBytes(this.host.assetUrl(relative))),
        );
        const loaded = [...this.runtimeFontBytes, ...bundled];
        this.fontBytes = loaded;
        this.mathFontAvailable = loaded.some((bytes) => fontHasMathTable(bytes));
        return loaded;
    }

    private ensureInitialized(signal: AbortSignal): Promise<void> {
        if (this.initPromise) return this.initPromise;
        this.initPromise = (async () => {
            const frame = this.host.createFrame(this.host.pageUrl());
            this.frame = frame;
            this.detachListener = frame.onMessage((event) => this.handleHostMessage(event));
            await this.readyPromiseOrTimeout(signal);
            const wasm = await this.host.fetchBytes(this.host.assetUrl(this.wasmPath));
            signal.throwIfAborted();
            const wasmBuffer = new Uint8Array(wasm).buffer;
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
                    reject(new OperationError('PDF_INIT_FAILED', `sandbox page did not signal ready within ${this.initTimeoutMs}ms`));
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

    private roundTrip(
        jobId: string,
        message: HostSandboxMessage,
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
                reject(new OperationError('PDF_TIMEOUT', `sandbox job ${jobId} timed out after ${timeoutMs}ms`));
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
                    // Frame may already be disposed.
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
            // Decoupled from compile completion because re-running the WASM font builder after a failed compile wedges the module.
            this.fontsInstalled = true;
            return;
        }
        const job = this.pending.get(jobId);
        if (!job) return;
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
                    ? body.diagnostics.map(readSandboxDiagnostic)
                    : [],
            });
        } else if (message.type === SANDBOX_TO_HOST.ERROR) {
            const { name, message: text } = readSandboxError(body.error);
            const error = new Error(text);
            error.name = name;
            job.reject(error);
        }
    }
}
