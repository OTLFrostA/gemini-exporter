export const driveScope = 'https://www.googleapis.com/auth/drive.file';

// Use the registered chromiumapp.org callback of the test Web OAuth client.
export async function authorizeDriveAccount(mode: 'switch' | 'connect' | 'restore', email?: string) {
    const config = await fetch(chrome.runtime.getURL('drive-account-client.json'));
    const client: unknown = config.ok ? await config.json() : null;
    if (typeof client !== 'string' || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(client))
        throw new Error('Drive account switching is not configured');
    const redirect = chrome.identity.getRedirectURL('drive-picker');
    const state = crypto.randomUUID();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
        client_id: client, redirect_uri: redirect, response_type: 'token', scope: driveScope, state,
        ...(mode === 'switch' ? { prompt: 'select_account' } : { login_hint: email ?? '' }),
        ...(mode === 'restore' ? { prompt: 'none' } : {}),
    }).toString();
    const result = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: mode !== 'restore' });
    if (!result) throw new Error('Google did not return an account authorization');
    const callback = new URL(result);
    if (callback.origin + callback.pathname !== redirect || callback.username || callback.password)
        throw new Error('Unexpected Google authorization callback');
    const params = new URLSearchParams(callback.hash.slice(1));
    if (params.getAll('state').length !== 1 || params.get('state') !== state) throw new Error('Invalid Google authorization state');
    const token = params.get('access_token');
    if (params.has('error') || !token || params.getAll('access_token').length !== 1
        || !params.get('scope')?.split(' ').includes(driveScope)) throw new Error('Google Drive authorization was not granted');
    return token;
}
