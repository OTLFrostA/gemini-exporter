import { isUuid } from './utils/typeGuards.js';

export const SOURCE_PLATFORMS = ['gemini', 'chatgpt', 'grok', 'claude'] as const;
export type SourcePlatform = typeof SOURCE_PLATFORMS[number];

/** A selected account has no verified signed-in source; website permission alone is insufficient. */
export class ScanConnectionError extends Error {
    constructor(readonly platform: SourcePlatform, message: string) {
        super(message);
        this.name = 'ScanConnectionError';
    }
}

export interface PlatformHostConfig {
    readonly name: string;
    readonly signInUrl: string;
    readonly conversationUrlPrefix: string;
    readonly pages: readonly string[];
    readonly attachments: readonly string[];
    readonly contentScripts: readonly [main: string, isolated: string];
    readonly conversationIdFormat: 'uuid' | 'hex';
    readonly supportsZipImport: boolean;
}

/** Site access and canonical platform metadata live in one table per source platform. */
export const PLATFORM_HOSTS = {
    gemini: {
        name: 'Gemini',
        signInUrl: 'https://gemini.google.com/',
        conversationUrlPrefix: 'https://gemini.google.com/app/',
        pages: ['https://gemini.google.com/*'],
        attachments: ['https://*.googleusercontent.com/*', 'https://*.usercontent.google.com/*',
            'https://drive.google.com/*', 'https://lh3.google.com/*', 'https://*.gstatic.com/*'],
        contentScripts: ['dist/content/hook.js', 'dist/content/content.js'],
        conversationIdFormat: 'hex',
        supportsZipImport: true,
    },
    chatgpt: {
        name: 'ChatGPT',
        signInUrl: 'https://chatgpt.com/',
        conversationUrlPrefix: 'https://chatgpt.com/c/',
        pages: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
        attachments: ['https://images.openai.com/*'],
        contentScripts: ['dist/content/chatgpt-hook.js', 'dist/content/chatgpt-content.js'],
        conversationIdFormat: 'uuid',
        supportsZipImport: true,
    },
    grok: {
        name: 'Grok',
        signInUrl: 'https://grok.com/',
        conversationUrlPrefix: 'https://grok.com/c/',
        pages: ['https://grok.com/*'],
        attachments: ['https://assets.grok.com/*'],
        contentScripts: ['dist/content/grok-hook.js', 'dist/content/grok-content.js'],
        conversationIdFormat: 'uuid',
        supportsZipImport: false,
    },
    claude: {
        name: 'Claude',
        signInUrl: 'https://claude.ai/',
        conversationUrlPrefix: 'https://claude.ai/chat/',
        pages: ['https://claude.ai/*'],
        attachments: [],
        contentScripts: ['dist/content/claude-hook.js', 'dist/content/claude-content.js'],
        conversationIdFormat: 'uuid',
        supportsZipImport: false,
    },
} as const satisfies Record<SourcePlatform, PlatformHostConfig>;

export function isValidPlatformConversationId(platform: SourcePlatform, value: unknown): value is string {
    if (PLATFORM_HOSTS[platform].conversationIdFormat === 'uuid') return isUuid(value);
    return typeof value === 'string' && /^[a-f0-9]{8,64}$/.test(value);
}

export function platformDisplayName(platform: SourcePlatform): string {
    return PLATFORM_HOSTS[platform].name;
}

export function platformSignInUrl(platform: SourcePlatform): string {
    return PLATFORM_HOSTS[platform].signInUrl;
}

export function platformConversationUrl(platform: SourcePlatform, conversationId: string): string {
    return PLATFORM_HOSTS[platform].conversationUrlPrefix + encodeURIComponent(conversationId);
}

export function platformOrigins(platform: SourcePlatform): string[] {
    return [...PLATFORM_HOSTS[platform].pages, ...PLATFORM_HOSTS[platform].attachments];
}

/** Direct image locators may only use the conversation platform's HTTPS origins. */
export function isPlatformImageUrl(platform: SourcePlatform, uri: string): boolean {
    try {
        const url = new URL(uri);
        if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
        return platformOrigins(platform).some(pattern => {
            const host = pattern.slice('https://'.length, -'/*'.length);
            if (!host.startsWith('*.')) return url.hostname === host;
            const suffix = host.slice(2);
            return url.hostname === suffix || url.hostname.endsWith('.' + suffix);
        });
    } catch { return false; }
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
