import { createGoogleOidcVerifier } from './auth/googleOidc.js';
import { createCloudServerHandler } from './router.js';
import { createCloudflareVaultStore, type D1DatabaseLike, type R2BucketLike } from './storage/vaultStore.js';

export interface WorkerEnv {
    readonly VAULT_DB: D1DatabaseLike;
    readonly VAULT_BLOBS: R2BucketLike;
    readonly SESSION_HMAC_SECRET: string;
    /** Comma-separated Google OAuth 2.0 Client IDs permitted to authenticate. */
    readonly GOOGLE_CLIENT_IDS: string;
    /** Comma-separated allowed Origins, e.g. `chrome-extension://<extension-id>`. */
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
        const handler = createCloudServerHandler({
            store: createCloudflareVaultStore(env.VAULT_DB, env.VAULT_BLOBS),
            oidcVerifier,
            config: {
                sessionHmacSecret: env.SESSION_HMAC_SECRET,
                googleClientIds: splitCsv(env.GOOGLE_CLIENT_IDS),
                allowedOrigins: splitCsv(env.ALLOWED_ORIGINS),
                ...(quotaOverride && Number.isSafeInteger(quotaOverride) && quotaOverride > 0
                    ? { defaultQuotaBytes: quotaOverride }
                    : {}),
            },
        });
        return handler(request);
    },
};
