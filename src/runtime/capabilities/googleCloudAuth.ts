import { OperationError } from '../../shared/errors/operationError.js';
import { bytesToHex } from '../../shared/crypto/index.js';
import { isRecord } from '../../shared/utils/typeGuards.js';

function randomHexToken(byteLength = 16): string {
    const buf = new Uint8Array(byteLength);
    crypto.getRandomValues(buf);
    return bytesToHex(buf);
}

function decodeJwtPayloadUnverified(jwt: string): Record<string, unknown> {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'Invalid Google ID token format');
    }
    const seg = parts[1];
    const padded = seg.replace(/-/g, '+').replace(/_/g, '/')
        + '='.repeat((4 - (seg.length % 4)) % 4);
    let jsonText: string;
    try {
        const bin = atob(padded);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        jsonText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'Failed to decode Google ID token payload');
    }
    const parsed: unknown = JSON.parse(jsonText);
    if (!isRecord(parsed)) {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'Malformed Google ID token claims');
    }
    return parsed;
}

/**
 * Request optional `identity` permission inside the user click gesture (if needed)
 * and run an interactive Google OpenID Connect `id_token` flow with CSRF `state` and replay `nonce` protection.
 */
export async function launchGoogleOidcIdTokenFlow(googleClientId: string): Promise<string> {
    const clientId = googleClientId.trim();
    if (!clientId) {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'Google OAuth Client ID is required');
    }

    if (chrome.permissions?.contains && chrome.permissions?.request) {
        const hasIdentity = await chrome.permissions.contains({ permissions: ['identity'] });
        if (!hasIdentity) {
            const granted = await chrome.permissions.request({ permissions: ['identity'] });
            if (!granted) {
                throw new OperationError('CLOUD_AUTH_REQUIRED', 'Browser identity permission was not granted');
            }
        }
    }

    if (!chrome.identity?.launchWebAuthFlow || !chrome.identity?.getRedirectURL) {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'Chrome identity OAuth API is unavailable in this browser');
    }

    const state = randomHexToken(16);
    const nonce = randomHexToken(16);
    const redirectUri = chrome.identity.getRedirectURL('google-cloud-sync');
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'id_token');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'openid email');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('prompt', 'select_account');

    const redirectResponseUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true,
    });
    if (!redirectResponseUrl) {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'Google sign-in was cancelled');
    }

    let callbackUrl: URL;
    try {
        callbackUrl = new URL(redirectResponseUrl);
    } catch {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'Invalid OAuth callback URL');
    }
    const fragment = callbackUrl.hash.startsWith('#') ? callbackUrl.hash.slice(1) : callbackUrl.hash;
    const params = new URLSearchParams(fragment);
    if (params.get('state') !== state) {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'OAuth state mismatch (CSRF check failed)');
    }
    const idToken = params.get('id_token');
    if (!idToken) {
        const err = params.get('error_description') ?? params.get('error') ?? 'No id_token returned by Google';
        throw new OperationError('CLOUD_AUTH_REQUIRED', err);
    }
    const claims = decodeJwtPayloadUnverified(idToken);
    if (claims.nonce !== nonce) {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'OAuth nonce mismatch (replay check failed)');
    }
    return idToken;
}
