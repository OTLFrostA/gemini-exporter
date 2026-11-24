import { chromium } from '@playwright/test';

/**
 * Use installed Google Chrome and load unpacked extensions via CDP. Stable
 * Chrome no longer accepts --load-extension on the command line.
 * @param {string} extensionPath
 * @param {{ profile?: string, headless?: boolean, acceptDownloads?: boolean }} [options]
 * @returns {Promise<{ context: import('@playwright/test').BrowserContext, extensionId: string }>}
 */
export async function launchChromeExtension(extensionPath, { profile = '', headless = true, acceptDownloads } = {}) {
    const context = await chromium.launchPersistentContext(profile, {
        channel: 'chrome',
        headless,
        chromiumSandbox: true,
        acceptDownloads,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: ['--enable-unsafe-extension-debugging'],
    });
    try {
        const browser = context.browser();
        if (!browser) throw new Error('Could not connect to the test Chrome browser');
        const session = await browser.newBrowserCDPSession();
        try {
            const { id: extensionId } = await session.send('Extensions.loadUnpacked', { path: extensionPath });
            return { context, extensionId };
        } finally {
            await session.detach();
        }
    } catch (error) {
        await context.close();
        throw error;
    }
}
