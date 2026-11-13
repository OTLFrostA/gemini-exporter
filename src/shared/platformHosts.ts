export const SOURCE_PLATFORMS = ['gemini', 'chatgpt', 'grok', 'claude'] as const;
export type SourcePlatform = typeof SOURCE_PLATFORMS[number];

/** A selected account has no verified signed-in source; website permission alone is insufficient. */
export class ScanConnectionError extends Error {
    constructor(readonly platform: SourcePlatform, message: string) {
        super(message);
        this.name = 'ScanConnectionError';
    }
}

/** Site access is requested as one independent group per source platform. */
export const PLATFORM_HOSTS = {
    gemini: {
        pages: ['https://gemini.google.com/*'],
        attachments: ['https://*.googleusercontent.com/*', 'https://*.usercontent.google.com/*',
            'https://drive.google.com/*', 'https://lh3.google.com/*', 'https://*.gstatic.com/*'],
    },
    chatgpt: {
        pages: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
        attachments: ['https://images.openai.com/*'],
    },
    grok: { pages: ['https://grok.com/*'], attachments: ['https://assets.grok.com/*'] },
    claude: { pages: ['https://claude.ai/*'], attachments: [] },
} as const satisfies Record<SourcePlatform, { pages: readonly string[]; attachments: readonly string[] }>;
export function platformOrigins(platform: SourcePlatform): string[] {
    return [...PLATFORM_HOSTS[platform].pages, ...PLATFORM_HOSTS[platform].attachments];
}

export function isSourcePlatform(value: unknown): value is SourcePlatform {
    return typeof value === 'string' && SOURCE_PLATFORMS.some(platform => platform === value);
}

/** Resolve a trusted source platform strictly from a page URL's origin. */
export function platformForPageUrl(url: string | undefined | null): SourcePlatform | null {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
        return SOURCE_PLATFORMS.find(platform =>
            PLATFORM_HOSTS[platform].pages.some(pattern => new URL(pattern).origin === parsed.origin)) ?? null;
    } catch {
        return null;
    }
}

export function matchesPlatformPageUrl(platform: SourcePlatform, url: string | undefined | null): boolean {
    return platformForPageUrl(url) === platform;
}

/** External image access is separate from platform connection and granted per origin. */
export const RESOURCE_DOWNLOAD_ORIGINS = ['https://cdn.sanity.io/*'] as const;
export function resourceDownloadOrigin(uri: string): string | undefined {
    try {
        const url = new URL(uri);
        if (url.protocol !== 'https:' || url.username || url.password) return undefined;
        return RESOURCE_DOWNLOAD_ORIGINS.find(origin => origin === `${url.origin}/*`);
    } catch { return undefined; }
}
