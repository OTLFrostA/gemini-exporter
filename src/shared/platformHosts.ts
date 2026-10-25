export const SOURCE_PLATFORMS = ['gemini', 'chatgpt', 'grok', 'claude'] as const;
export type SourcePlatform = typeof SOURCE_PLATFORMS[number];

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
