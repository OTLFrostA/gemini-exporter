import { createGoogleOidcVerifier } from './auth/googleOidc.js';
import { createCloudServerHandler } from './router.js';
import { createCloudflareVaultStore, type D1DatabaseLike, type R2BucketLike } from './storage/vaultStore.js';

export interface WorkerEnv {
    readonly VAULT_DB: D1DatabaseLike;
    readonly VAULT_BLOBS: R2BucketLike;
    readonly SESSION_HMAC_SECRET: string;
    /** Optional shared access/invite code guarding `/v1/auth/key`. */
    readonly SERVER_ACCESS_CODE?: string;
    /** Optional comma-separated Google OAuth 2.0 Client IDs if OIDC login is also enabled. */
    readonly GOOGLE_CLIENT_IDS?: string;
    /** Comma-separated allowed Origins, e.g. `chrome-extension://*`. */
    readonly ALLOWED_ORIGINS?: string;
    /** Optional per-user quota override in bytes (defaults to 100 MiB). */
    readonly DEFAULT_QUOTA_BYTES?: string;
}

const oidcVerifier = createGoogleOidcVerifier();

function splitCsv(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw.split(',').map(part => part.trim()).filter(Boolean);
}

export default {
    async fetch(request: Request, env: WorkerEnv): Promise<Response> {
        const quotaOverride = env.DEFAULT_QUOTA_BYTES ? Number(env.DEFAULT_QUOTA_BYTES) : undefined;
        const allowed = splitCsv(env.ALLOWED_ORIGINS);
        const handler = createCloudServerHandler({
            store: createCloudflareVaultStore(env.VAULT_DB, env.VAULT_BLOBS),
            oidcVerifier,
            config: {
                sessionHmacSecret: env.SESSION_HMAC_SECRET,
                googleClientIds: splitCsv(env.GOOGLE_CLIENT_IDS),
                ...(env.SERVER_ACCESS_CODE?.trim() ? { serverAccessCode: env.SERVER_ACCESS_CODE.trim() } : {}),
                allowedOrigins: allowed.length > 0 ? allowed : ['chrome-extension://*'],
                ...(quotaOverride && Number.isSafeInteger(quotaOverride) && quotaOverride > 0
                    ? { defaultQuotaBytes: quotaOverride }
                    : {}),
            },
        });
        return handler(request);
    },
};
