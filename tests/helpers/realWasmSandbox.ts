/**
 * tests/helpers/realWasmSandbox.ts
 *
 * Real-WASM sandbox host/frame for D8 evidence tests (Tier 1).
 *
 * Drives the REAL, unmodified TypstSandboxCompiler (product code) against a
 * test frame that runs the REAL @myriaddreamin/typst.ts WASM compiler using
 * the product's exact sandbox recipe -- a line-by-line mirror of
 * src/l4/format/pdf/sandbox/typstCompileEntry.ts.
 *
 * Performance optimization (zero fidelity loss):
 *  - Pre-compiles the 27 MB `WebAssembly.Module` once per process (`wasmModuleCache`)
 *    so repeated `new TypstSandboxCompiler()` instances instantiate WASM in ~2ms
 *    instead of re-compiling 54 MB of bytecode per test.
 *  - Caches immutable disk reads (WASM binary, bundled offline fonts, and Typst
 *    templates) in memory per repo root.
 */

export {};
const { visual } = require('../../src/l4/format/shared/visualContract.ts');
const fs = require('node:fs');
const path = require('node:path');

const { createTypstCompiler, createTypstFontBuilder } = require('@myriaddreamin/typst.ts');
const { createOfflineInitOptions } = require('../../src/l4/format/pdf/sandbox/offlineInit.js');
const {
    HOST_TO_SANDBOX,
    SANDBOX_TO_HOST,
} = require('../../src/l4/format/pdf/typst/sandboxProtocol.js');

const PDF_FORMAT = 1;

export function repoRoot(): string {
    return path.resolve(__dirname, '..', '..');
}

const TEMPLATE_FILES: ReadonlyArray<readonly [string, string]> = [
    ['/theme.typ', 'theme.typ'],
    ['/document.typ', 'document.typ'],
    ['/components.typ', 'components.typ'],
    ['/render-block.typ', 'render-block.typ'],
    ['/render-inline.typ', 'render-inline.typ'],
    ['/render-message.typ', 'render-message.typ'],
    ['/mitex-scope.typ', 'mitex-scope.typ'],
    ['/quiet-light.tmTheme', 'quiet-light.tmTheme'],
];

const MAIN_TYP = '#import "document.typ": render-document\n#let payload = json("/payload.json")\n#render-document(payload)\n';

const fileByteCache = new Map<string, Uint8Array>();
const templateCache = new Map<string, Array<[string, string]>>();
const wasmModuleCache = new Map<number, Promise<WebAssembly.Module>>();

function loadTemplates(repo: string): Array<[string, string]> {
    let cached = templateCache.get(repo);
    if (!cached) {
        const dir = path.join(repo, 'src/l4/format/typst/templates');
        cached = TEMPLATE_FILES.map(([vpath, name]) => [
            vpath,
            fs.readFileSync(path.join(dir, name), 'utf8'),
        ] as [string, string]);
        cached.push(['/visual-contract.json', JSON.stringify(visual)]);
        templateCache.set(repo, cached);
    }
    return cached;
}

function getCompiledWasmModule(wasm: ArrayBuffer): Promise<WebAssembly.Module> {
    const key = wasm.byteLength;
    let compiled = wasmModuleCache.get(key);
    if (!compiled) {
        compiled = WebAssembly.compile(wasm).catch((err: unknown) => {
            wasmModuleCache.delete(key);
            throw err;
        });
        wasmModuleCache.set(key, compiled);
    }
    return compiled;
}

interface FrameStats {
    framesCreated: number;
    listenersAttached: number;
    listenersDetached: number;
    framesDestroyed: number;
}

function freshFrameStats(): FrameStats {
    return { framesCreated: 0, listenersAttached: 0, listenersDetached: 0, framesDestroyed: 0 };
}

type MessageHandler = (event: { source: unknown; origin: string; data: unknown }) => void;

class RealWasmSandboxFrame {
    readonly contentWindow: object = {};
    private handler: MessageHandler | null = null;
    private compiler: any = null;
    private fontBuilder: any = null;
    private fontsInstalled = false;
    private readonly templates: Array<[string, string]>;

    constructor(
        private readonly stats: FrameStats,
        repo: string,
    ) {
        this.templates = loadTemplates(repo);
    }

    postToSandbox(message: Record<string, unknown>, _transfer?: unknown): void {
        queueMicrotask(() => {
            void this.dispatch(message).catch((error: unknown) => {
                this.emit({
                    type: SANDBOX_TO_HOST.ERROR,
                    jobId: message.jobId,
                    error: { name: 'Error', message: error instanceof Error ? error.message : String(error) },
                });
            });
        });
    }

    onMessage(handler: MessageHandler): () => void {
        this.stats.listenersAttached += 1;
        this.handler = handler;
        queueMicrotask(() => this.emit({ type: SANDBOX_TO_HOST.READY }));
        return () => {
            this.stats.listenersDetached += 1;
            if (this.handler === handler) this.handler = null;
        };
    }

    destroy(): void {
        this.stats.framesDestroyed += 1;
        this.handler = null;
        this.compiler = null;
        this.fontBuilder = null;
    }

    private emit(data: Record<string, unknown>): void {
        this.handler?.({ source: this.contentWindow, origin: 'null', data });
    }

    private reply(jobId: unknown, payload: Record<string, unknown>): void {
        this.emit({ jobId, ...payload });
    }

    private async dispatch(message: Record<string, unknown>): Promise<void> {
        const type = message.type as string;
        const jobId = message.jobId as string;
        if (type === HOST_TO_SANDBOX.INIT) {
            const wasm = message.wasm;
            if (!(wasm instanceof ArrayBuffer)) {
                throw new Error('init message must carry the WASM module as an ArrayBuffer');
            }
            const wasmModule = await getCompiledWasmModule(wasm);
            const initOpts = createOfflineInitOptions(() => wasmModule as unknown as Uint8Array);
            this.compiler = createTypstCompiler();
            await this.compiler.init(initOpts);
            this.fontBuilder = createTypstFontBuilder();
            await this.fontBuilder.init(initOpts);
            this.fontsInstalled = false;
            this.reply(jobId, { type: SANDBOX_TO_HOST.INITED, ok: true });
        } else if (type === HOST_TO_SANDBOX.COMPILE) {
            await this.handleCompile(jobId, message);
        } else if (type === HOST_TO_SANDBOX.CANCEL) {
            // Host-side abort already rejects pending promises.
        }
    }

    private async handleCompile(jobId: string, body: Record<string, unknown>): Promise<void> {
        const compiler = this.compiler;
        const fontBuilder = this.fontBuilder;
        if (!compiler || !fontBuilder) {
            throw new Error('compiler not initialized; send typst/init first');
        }
        const mappedPaths: string[] = [];
        try {
            const files = body.files as Array<{ path?: unknown; text?: unknown }>;
            const binaries = body.binaries as Array<{ path?: unknown; buf?: unknown }>;
            const fonts = body.fonts as unknown[];
            if (!Array.isArray(files) || !Array.isArray(binaries) || !Array.isArray(fonts)) {
                throw new Error('compile message must carry files/binaries/fonts arrays');
            }
            for (const [vpath, text] of this.templates) compiler.addSource(vpath, text);
            compiler.addSource('/main.typ', MAIN_TYP);
            for (const file of files) {
                if (typeof file.path !== 'string' || typeof file.text !== 'string') {
                    throw new Error('compile file entries must be {path, text} strings');
                }
                compiler.addSource(file.path, file.text);
            }
            for (const binary of binaries) {
                if (typeof binary.path !== 'string' || !(binary.buf instanceof ArrayBuffer)) {
                    throw new Error('compile binary entries must be {path, buf:ArrayBuffer}');
                }
                const shadowPath = binary.path.startsWith('/') ? binary.path : `/${binary.path}`;
                compiler.mapShadow(shadowPath, new Uint8Array(binary.buf));
                mappedPaths.push(shadowPath);
            }
            if (fonts.length > 0 && !this.fontsInstalled) {
                for (const font of fonts) {
                    if (!(font instanceof ArrayBuffer)) {
                        throw new Error('compile font entries must be ArrayBuffers');
                    }
                    await fontBuilder.addFontData(new Uint8Array(font as ArrayBuffer));
                }
                await fontBuilder.build(async (resolver: unknown) => {
                    compiler.setFonts(resolver);
                });
                this.fontsInstalled = true;
                this.reply(jobId, { type: SANDBOX_TO_HOST.FONTS_INSTALLED });
            } else if (fonts.length > 0) {
                this.reply(jobId, { type: SANDBOX_TO_HOST.FONTS_INSTALLED });
            }
            const { result, diagnostics } = await compiler.compile({
                mainFilePath: '/main.typ',
                format: PDF_FORMAT,
            });
            let pdf: ArrayBuffer | null = null;
            if (result && result.length > 0) {
                pdf = result.slice().buffer as ArrayBuffer;
            }
            this.reply(jobId, {
                type: SANDBOX_TO_HOST.COMPILED,
                ok: pdf !== null,
                pdf,
                pdfBytes: result ? result.length : 0,
                diagnostics: (diagnostics ?? []).map((d: unknown) => {
                    const detail = typeof d === 'string' ? { severity: 'error', message: d } : (d as Record<string, unknown>);
                    return {
                        severity: typeof detail.severity === 'string' ? detail.severity : 'error',
                        message: String(detail.message ?? '').slice(0, 500),
                    };
                }),
            });
        } finally {
            try {
                for (const p of mappedPaths) compiler.unmapShadow(p);
            } catch {
                // Best effort; never mask the real result.
            }
        }
    }
}

export class RealWasmSandboxHost {
    readonly stats: FrameStats = freshFrameStats();
    constructor(private readonly repo: string = repoRoot()) {}

    pageUrl(): string {
        return 'https://test.invalid/sandbox/typst-compile.html';
    }

    assetUrl(relativePath: string): string {
        if (path.isAbsolute(relativePath)) return relativePath;
        return path.join(this.repo, relativePath);
    }

    async fetchBytes(url: string): Promise<Uint8Array> {
        let cached = fileByteCache.get(url);
        if (!cached) {
            const buf = fs.readFileSync(url);
            cached = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
            fileByteCache.set(url, cached);
        }
        return cached;
    }

    createFrame(_url: string): RealWasmSandboxFrame {
        this.stats.framesCreated += 1;
        return new RealWasmSandboxFrame(this.stats, this.repo);
    }
}

export function resolveLocalCjkFont(): string | null {
    const candidates = [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/STHeiti Light.ttc',
        'C:\\Windows\\Fonts\\msyh.ttc',
        'C:\\Windows\\Fonts\\simsun.ttc',
    ];
    for (const c of candidates) {
        try {
            if (fs.statSync(c).isFile()) return c;
        } catch {
            // keep looking
        }
    }
    return null;
}
