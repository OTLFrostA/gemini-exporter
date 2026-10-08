import { parseGeminiRpcConversation } from '../../src/core/parsers/gemini/rpc/parseConversation.js';
import { parseGeminiTakeoutArchive } from '../../src/core/parsers/gemini/takeout/parseConversation.js';
import type { ResourceConversationParseResult } from '../../src/core/parsers/parsingResult.js';

export const mediaChatId = 'source-media';
export const mediaPrompt = 'Draw a diagram of a green bridge';
export const mediaTime = 1788350400000;
export const mediaBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
const otherMediaBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
function bytesFor(path: string) { return path.endsWith('/archive-0.png') ? mediaBytes : otherMediaBytes; }
export function mediaSources(options: { noTime?: boolean; noPrompt?: boolean; multi?: boolean; duplicate?: boolean; requestId?: string; uriSuffix?: string } = {}) {
    const images = Array.from({ length: options.multi ? 2 : 1 }, (_, i) => {
        const image: unknown[] = Array(16).fill(null);
        image[2] = `online-${i}.png`; image[3] = `https://lh3.googleusercontent.com/media-source-${i}${options.uriSuffix ?? ''}`;
        image[11] = 'image/png'; image[15] = [1, 1, mediaBytes.length];
        return image;
    });
    const turns = Array.from({ length: 10 }, (_, i) => [[`c_${mediaChatId}`, i === 9 && options.requestId ? options.requestId : `r_request-${i}`],
        options.noTime && i === 9 ? null : [(mediaTime / 1000) + (i === 9 ? 0 : i - 20), 123000000],
        options.noPrompt && i === 9 ? null : [[i === 9 ? mediaPrompt : `Online question ${i}`]],
        [[`rc_answer-${i}`, [[`Complete online answer ${i}`], ...(i === 9 ? images : [])]]]]);
    const online = parseGeminiRpcConversation(`)]}'\n\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([turns, null, 'Complete online body'])]])}`,
        { providerId: 'gemini', targetConvId: mediaChatId });
    const activity = (prompt: string, time: number, answer: string, count?: number) =>
        `<div class="outer-cell"><a href="https://gemini.google.com/app/c_${mediaChatId}">Chat</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted ${prompt}<br>${new Date(time).toISOString()}<br>${answer}</div>${count ? `${count} generated image${count > 1 ? 's' : ''}` : ''}</div>`;
    let html = Array.from({ length: 6 }, (_, i) => activity(i === 5 ? mediaPrompt : `Takeout question ${i}`, mediaTime + (i === 5 ? 0 : (i - 20) * 1000),
        `<p>Takeout answer ${i}${i === 0 ? '<img src="previous.png">' : i === 5 ? images.map((_, j) => `<img src="archive-${j}.png">`).join('') : ''}</p>`, i === 0 ? 1 : i === 5 ? images.length : undefined)).join('');
    const files = Object.fromEntries(['previous.png', ...images.map((_, i) => `archive-${i}.png`)].map(name => {
        const path = `Takeout/Gemini Apps/${name}`, bytes = bytesFor(path);
        return [path, { _data: { uncompressedSize: bytes.length }, async: async () => bytes.slice() }];
    }));
    if (options.duplicate) {
        html += activity(mediaPrompt, mediaTime, '<p><img src="duplicate.png"></p>', 1);
        files['Takeout/Gemini Apps/duplicate.png'] = { _data: { uncompressedSize: otherMediaBytes.length }, async: async () => otherMediaBytes.slice() };
    }
    const takeout = parseGeminiTakeoutArchive({ htmlText: html, archiveFiles: files, activityPath: 'Takeout/Gemini Apps/MyActivity.html' }, { providerId: 'gemini' })[0];
    const offline: ResourceConversationParseResult = { ...takeout, resourceHints: Object.fromEntries(Object.entries(takeout.archiveResources).map(([id, bound]) => [id, { archivePath: bound.path }])) };
    const resources = Object.entries(takeout.archiveResources).map(([assetId, bound]) => ({ assetId, sourcePath: bound.path, bytes: bytesFor(bound.path).slice() }));
    return { online, offline, files, resources };
}
