import type { ReadonlyDomain } from '../../domain/runtimeValidation.js';
import type { ResourceBindings } from './resourceBindings.js';
import type { PreparedResources } from '../../resources/resourceResult.js';
import type { ExportArtifact } from '../artifacts.js';
import { buildExportFileName, sanitizeFileName, shortScope } from '../../utils/pathUtils.js';
import { ZipWriter } from '../../engine/writers/zipWriter.js';
import { assertExportPath } from './exportPath.js';

export type ExportFormat = 'markdown' | 'html' | 'json' | 'pdf';
export type ExportDelivery = 'browserDownload' | 'folderWriter';
export type ExportPathPlan = Readonly<{ fileName: string; resources: ResourceBindings }>;
const extensions = { markdown: 'md', html: 'html', json: 'json', pdf: 'pdf' } as const;
const mimeTypes = { markdown: 'text/markdown; charset=utf-8', html: 'text/html; charset=utf-8',
    json: 'application/json; charset=utf-8', pdf: 'application/pdf' } as const;
const resourceExtensions: Readonly<Record<string, string>> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'text/plain': 'txt',
    'text/markdown': 'md', 'application/json': 'json', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4',
};

export function planExportPaths(
    inputs: readonly { conversation: ReadonlyDomain; prepared: PreparedResources }[],
    format: ExportFormat,
): readonly ExportPathPlan[] {
    const used = new Set<string>();
    function reserve(directory: string, name: string): string {
        // Percent is literal source text, never a second encoded path supplied to a writer.
        const clean = sanitizeFileName(name.replace(/%/g, '_'));
        const lastDot = clean.lastIndexOf('.');
        const dot = lastDot > 0 && clean.length - lastDot <= 6 ? lastDot : -1;
        const base = dot > 0 ? clean.slice(0, dot) : clean;
        const ext = dot > 0 ? clean.slice(dot) : '';
        for (let n = 1; ; n++) {
            const suffix = n === 1 ? '' : `_${n}`;
            const candidate = directory + sanitizeFileName([...base].slice(0, 70 - suffix.length).join('') + suffix + ext);
            assertExportPath(candidate);
            const key = candidate.toLowerCase();
            if (!used.has(key)) { used.add(key); return candidate; }
        }
    }
    return inputs.map(({ conversation, prepared }) => {
        const id = conversation.index.key.conversationId;
        const fileName = reserve('', buildExportFileName(conversation.index.title, id, extensions[format]));
        const resources: Record<string, string> = Object.create(null);
        for (const asset of conversation.detail.assets) {
            const result = prepared.get(asset.id);
            if (!result?.ok) continue;
            const mediaType = result.value.mediaType ?? asset.mediaType;
            const extension = resourceExtensions[mediaType ?? ''] ?? (asset.document ? 'md' : asset.kind === 'image' ? 'jpg' : 'bin');
            const baseName = sanitizeFileName(asset.name || asset.id);
            const name = asset.name && /\.[^.]+$/.test(baseName) ? baseName : `${baseName}.${extension}`;
            resources[asset.id] = reserve(asset.kind === 'image' ? 'assets/' : 'files/', shortScope(id) + name);
        }
        return { fileName, resources };
    });
}

/** Application fills prepared mediaType from acquisition metadata, then trusted
 * DomainAsset.mediaType. Packaging uses octet-stream when neither is available. */
export function buildExportFiles(format: ExportFormat, plan: ExportPathPlan,
    content: string | Uint8Array, prepared: PreparedResources): ExportArtifact[] {
    assertExportPath(plan.fileName);
    const files: ExportArtifact[] = [{ fileName: plan.fileName, mimeType: mimeTypes[format], content }];
    if (format === 'pdf') return files;
    for (const [id, path] of Object.entries(plan.resources)) {
        assertExportPath(path);
        const result = prepared.get(id);
        if (!result?.ok) throw new Error(`Bound resource unavailable: ${id}`);
        files.push({ fileName: path, mimeType: result.value.mediaType ?? 'application/octet-stream', content: result.value.bytes });
    }
    return files;
}

export async function packageExportFiles(groups: readonly (readonly ExportArtifact[])[],
    delivery: ExportDelivery, userRequestedZip: boolean): Promise<ExportArtifact[]> {
    const nonempty = groups.filter(group => group.length > 0);
    const files = nonempty.flatMap(group => [...group]);
    const paths = new Set<string>();
    for (const file of files) {
        assertExportPath(file.fileName);
        const key = file.fileName.toLowerCase();
        if (paths.has(key)) throw new Error(`Duplicate export path: ${file.fileName}`);
        paths.add(key);
    }
    if (!files.length || !(userRequestedZip || (delivery === 'browserDownload' && files.length > 1))) return files;
    const writer = new ZipWriter();
    for (const file of files) {
        if (writer.writeFile(file.fileName, file.content) !== file.fileName) throw new Error('ZIP writer changed planned path');
    }
    const fileName = nonempty.length === 1
        ? sanitizeFileName(nonempty[0][0].fileName.replace(/\.[^.]+$/, '') + '.zip')
        : `conversations_${Date.now()}.zip`;
    return [{ fileName, mimeType: 'application/zip', content: await writer.generateBlob() }];
}
