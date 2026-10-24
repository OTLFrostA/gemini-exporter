import { platformOrigins, type SourcePlatform } from '../../shared/platformHosts.js';

export async function hasPlatformAccess(platform: SourcePlatform): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return false;
    try { return await chrome.permissions.contains({ origins: platformOrigins(platform) }); }
    catch { return false; }
}

/** Start the native request synchronously in the Connect button's user gesture. */
export async function requestPlatformAccess(platform: SourcePlatform): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.permissions?.request) return false;
    try { return await chrome.permissions.request({ origins: platformOrigins(platform) }); }
    catch { return false; }
}
