import { isRecord } from '../../shared/utils/typeGuards.js';

export async function pickDriveFolder(email: string, signal: AbortSignal) {
    const config = await fetch(chrome.runtime.getURL('drive-picker.json'), { signal });
    const settings: unknown = config.ok ? await config.json() : null;
    if (!isRecord(settings) || typeof settings.clientId !== 'string'
        || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(settings.clientId)) {
        throw new Error('Configure the hosted Picker Web OAuth client for this test build');
    }

    const redirect = chrome.identity.getRedirectURL('drive-picker');
    const state = crypto.randomUUID();
    const request = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    request.search = new URLSearchParams({
        client_id: settings.clientId, redirect_uri: redirect, response_type: 'token',
        scope: 'https://www.googleapis.com/auth/drive.file', state, login_hint: email,
        prompt: 'consent', trigger_onepick: 'true', allow_folder_selection: 'true',
        mimetypes: 'application/vnd.google-apps.folder',
    }).toString();
    let result: string | undefined;
    try {
        result = await chrome.identity.launchWebAuthFlow({ url: request.href, interactive: true });
    } catch (error) {
        if (error instanceof Error && error.message === 'The user did not approve access.') return;
        throw new Error('Google did not complete the hosted folder selection');
    }
    signal.throwIfAborted();
    if (!result) throw new Error('Missing Google Picker callback');
    const callback = new URL(result);
    const expected = new URL(redirect);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.username || callback.password)
        throw new Error('Unexpected Google Picker callback');
    const params = new URLSearchParams(callback.hash.slice(1));
    for (const [key, value] of callback.searchParams) params.append(key, value);
    if (params.getAll('state').length !== 1 || params.get('state') !== state) throw new Error('Invalid Google Picker state');
    if (params.get('error') === 'access_denied') return;
    if (params.has('error')) throw new Error('Google rejected the folder selection');
    const token = new URLSearchParams(callback.hash.slice(1)).get('access_token');
    const id = params.get('picked_file_ids');
    if (!token || params.getAll('access_token').length !== 1 || !id || !/^[\w-]+$/.test(id)
        || params.getAll('picked_file_ids').length !== 1) throw new Error('Google did not return a single folder and access token');
    return { id, token };
}
