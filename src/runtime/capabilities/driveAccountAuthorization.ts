const driveScope = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_OPTIONAL_PERMISSIONS = ['identity'] as const;
export const DRIVE_OPTIONAL_ORIGINS = ['https://www.googleapis.com/*'] as const;

const drivePermissionsRequest: chrome.permissions.Permissions = {
    permissions: [...DRIVE_OPTIONAL_PERMISSIONS],
    origins: [...DRIVE_OPTIONAL_ORIGINS],
};

export type DriveAuthErrorCode =
    | 'unconfigured'
    | 'permission_denied'
    | 'cancelled'
    | 'account_mismatch'
    | 'auth_failed';

export class DriveAuthError extends Error {
    constructor(readonly code: DriveAuthErrorCode, message: string) {
        super(message);
        this.name = 'DriveAuthError';
    }
}

let accountClient: Promise<string> | undefined;

function loadAccountClient(): Promise<string> {
    accountClient ??= (async () => {
        const config = await fetch(chrome.runtime.getURL('drive-account-client.json'));
        const client: unknown = config.ok ? await config.json() : null;
        if (typeof client !== 'string' || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(client))
            throw new DriveAuthError('unconfigured', 'Drive account switching is not configured');
        return client;
    })().catch(error => {
        accountClient = undefined;
        throw error;
    });
    return accountClient;
}

export async function isDriveDeliveryConfigured(): Promise<boolean> {
    const canRequest = typeof chrome.permissions?.request === 'function';
    const hasIdentity = typeof chrome.identity?.launchWebAuthFlow === 'function';
    if (!canRequest && !hasIdentity) return false;
    return loadAccountClient().then(() => true, () => false);
}

async function hasDrivePermissions(): Promise<boolean> {
    if (typeof chrome.permissions?.contains === 'function') {
        return chrome.permissions.contains(drivePermissionsRequest);
    }
    return typeof chrome.identity?.launchWebAuthFlow === 'function';
}

/**
 * Request optional Google Drive permissions (`identity` + `https://www.googleapis.com/*`).
 * Must be invoked synchronously inside a user click gesture.
 */
export function requestDrivePermissions(): Promise<boolean> {
    if (typeof chrome.permissions?.request === 'function') {
        return chrome.permissions.request(drivePermissionsRequest);
    }
    return Promise.resolve(typeof chrome.identity?.launchWebAuthFlow === 'function');
}

function isUserCancelledAuthError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /did not approve|cancel(?:ed|led)|user closed|window closed|access_denied/i.test(message);
}

export async function authorizeDriveAccount(mode: 'switch' | 'connect' | 'restore', email?: string) {
    if (mode === 'restore' && !await hasDrivePermissions()) {
        throw new DriveAuthError('permission_denied', 'Google Drive permission has not been granted');
    }
    if (typeof chrome.identity?.launchWebAuthFlow !== 'function') {
        throw new DriveAuthError('permission_denied', 'Google Drive identity permission is unavailable');
    }
    const client = await loadAccountClient();
    const redirect = chrome.identity.getRedirectURL('drive-auth');
    const state = crypto.randomUUID();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
        client_id: client, redirect_uri: redirect, response_type: 'token', scope: driveScope, state,
        ...(email ? { login_hint: email } : { prompt: 'select_account' }),
        ...(mode === 'restore' ? { prompt: 'none' } : {}),
    }).toString();
    let result: string | undefined;
    try {
        result = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: mode !== 'restore' });
    } catch (error) {
        if (isUserCancelledAuthError(error)) {
            throw new DriveAuthError('cancelled', error instanceof Error ? error.message : 'Google Drive authorization was cancelled');
        }
        throw new DriveAuthError('auth_failed', error instanceof Error ? error.message : String(error));
    }
    if (!result) throw new DriveAuthError('auth_failed', 'Google did not return an account authorization');
    const callback = new URL(result);
    if (callback.origin + callback.pathname !== redirect || callback.username || callback.password)
        throw new DriveAuthError('auth_failed', 'Unexpected Google authorization callback');
    const params = new URLSearchParams(callback.hash.slice(1));
    if (params.getAll('state').length !== 1 || params.get('state') !== state)
        throw new DriveAuthError('auth_failed', 'Invalid Google authorization state');
    const oauthError = params.get('error');
    if (oauthError === 'access_denied') {
        throw new DriveAuthError('cancelled', 'Google Drive authorization was cancelled');
    }
    const token = params.get('access_token');
    if (oauthError || !token || params.getAll('access_token').length !== 1
        || !params.get('scope')?.split(' ').includes(driveScope)) {
        throw new DriveAuthError('auth_failed', oauthError ? `Google Drive authorization failed: ${oauthError}` : 'Google Drive authorization was not granted');
    }
    return token;
}
