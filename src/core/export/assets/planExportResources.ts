import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { attemptResource, missingResource, type ResourceFailure } from '../../resources/resourceResult.js';
import type { AssetPipelineItem } from '../../engine/assetPipeline.js';
import { sanitizeFileName, sanitizeRelativePath, shortScope } from '../../utils/pathUtils.js';
import { highResVariant } from '../../compatibility/gemini/attachments.js';
import { decodeDataUrlAsset } from './dataUrl.js';

export interface ExportAssetPlan { assetId: string; item: AssetPipelineItem; isImage: boolean; content?: string | Uint8Array }
/** Allocate file destinations once, outside source parsing and without projecting message bodies. */
export async function planExportResources(result: ResourceConversationParseResult): Promise<{ result: ResourceConversationParseResult; assets: ExportAssetPlan[]; failures: ResourceFailure[] }> {
    const resourceHints = {};
    const failures: ResourceFailure[] = [];
    const assets: ExportAssetPlan[] = [];
    const used = new Set<string>();
    for (const asset of result.conversation.assets) {
        const isImage = asset.kind === 'image';
        const fallback = `${asset.id}.${isImage ? 'jpg' : asset.document?.contentMarkdown ? 'md' : 'bin'}`;
        let name = sanitizeFileName(asset.name || fallback, fallback);
        if (asset.document?.contentMarkdown && !/\.md$/i.test(name)) name += '.md';
        let path = `${isImage ? 'assets' : 'files'}/${shortScope(result.conversation.id)}${name}`;
        const existingPath = result.resourceHints[asset.id]?.archivePath;
        if (existingPath && result.conversation.provenance?.source !== 'gemini-takeout') path = sanitizeRelativePath(existingPath);
        let content: string | Uint8Array | undefined = asset.document?.contentMarkdown;
        const dataUrl = asset.dataBase64 ? `data:${asset.mediaType ?? 'application/octet-stream'};base64,${asset.dataBase64}`
            : asset.source?.uri?.startsWith('data:') ? asset.source.uri : undefined;
        if (dataUrl) {
            const attempt = await attemptResource(asset.id, () => decodeDataUrlAsset(dataUrl));
            if (!attempt.ok) { failures.push(attempt); continue; }
            const decoded = attempt.value;
            if (!decoded.ok) { failures.push(missingResource(asset.id, decoded.message, decoded.code)); continue; }
            content = decoded.bytes; path = decoded.storageRef;
        }
        path = sanitizeRelativePath(path);
        const original = path; let index = 2;
        while (used.has(path)) {
            const suffix = `_${index++}`;
            // Reserve the suffix before the writer's filename length limit is applied.
            path = original.replace(/([^/]+?)(\.[^/.]+)?$/, (_match, base: string, ext: string | undefined) =>
                `${Array.from(base).slice(0, 70 - suffix.length).join('')}${suffix}${ext ?? ''}`);
            path = sanitizeRelativePath(path);
        }
        used.add(path);
        const source = result.acquisitionHints[asset.id] ?? {};
        const generation = asset.generation?.chatId && asset.generation.generationOrdinal !== undefined
            ? { ...asset.generation, chatId: asset.generation.chatId, generationOrdinal: asset.generation.generationOrdinal } : undefined;
        const item: AssetPipelineItem = { assetId: asset.id, url: source.url ?? asset.source?.uri,
            sourceUrl: source.sourceUrl ?? asset.source?.uri, resolvedUrl: source.resolvedUrl ?? (isImage && /^https?:/.test(asset.source?.uri ?? '') ? highResVariant(asset.source!.uri!) : undefined),
            src: source.src, candidates: source.candidates, localName: path, fileName: path.split('/').pop(),
            name: asset.name, title: asset.name, mimeType: asset.mediaType, type: isImage ? 'image' : 'file', generation };
        assets.push({ assetId: asset.id, item, isImage, ...(content !== undefined ? { content } : {}) });
    }
    return { result: { ...result, resourceHints }, assets, failures };
}
