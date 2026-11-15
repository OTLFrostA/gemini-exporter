# Gemini Exporter — Zero-Knowledge E2EE Cloud Vault (`cloud-server`)

Multi-tenant, zero-knowledge end-to-end encrypted conversation backup server built for **Cloudflare Workers + D1 + R2**.

## Security Guarantees
1. **Strict Zero-Knowledge Persistence**:
   - The server stores only `google:<sub>` opaque tenant IDs, monotonic sequence numbers, byte counts, and `GEE1` `AES-256-GCM` ciphertext blobs.
   - **Zero PII / Zero Metadata**: No plaintext emails, conversation titles, AI provider names (`gemini` / `chatgpt` / `claude` / `grok`), or native conversation IDs are ever stored in D1 or R2.
   - **Plaintext Interlock**: `PUT /v1/vault/records/:blindRecordId` rejects any payload that lacks the `GEE1` binary AEAD header (`400 PLAINTEXT_REJECTED`).
2. **Cryptographic Tenant & Slot Binding**:
   - Clients bind `(ownerSubject, blindRecordId, revision)` into `AES-256-GCM` Additional Authenticated Data (AAD). Even a compromised server operator cannot swap blobs across users, swap blobs across conversations, or roll back revisions undetected.
3. **Immutable Versioned R2 Keys & Optimistic Concurrency**:
   - Blobs are written to immutable versioned R2 keys (`v1/<subject>/<blindId>/r<rev>`) before an atomic `D1.batch()` pointer swap conditioned on `X-Expected-Revision`, preventing torn writes or R2/D1 desynchronization under multi-device contention.

## Zero-Config Key-Derived Authentication
- Uses HKDF-SHA256 domain separation (`gemini-exporter/cloud-e2ee/v1/server-auth-token`) to derive a 256-bit `authToken` orthogonal to the local `AES-256-GCM` encryption key.
- No Google Cloud OAuth Client ID, redirect URI, or user account registration is required.
- Optionally set a `SERVER_ACCESS_CODE` secret to restrict access to yourself or invited testers.

## Local Standalone Server (Instant Zero-Account Testing)
```bash
# Starts a local HTTP Cloud Vault at http://127.0.0.1:8788 backed by temp/local-cloud-vault/
npm run cloud:local
# Or with an access code:
SERVER_ACCESS_CODE=my-secret-passcode npm run cloud:local
```

## Cloudflare Workers Deployment (3 Minutes, $0 Free Tier)
```bash
npx wrangler login
cd cloud-server

# 1. Create D1 database and R2 bucket
npx wrangler d1 create gemini_exporter_vault_db
npx wrangler r2 bucket create gemini-exporter-vault-blobs

# 2. Paste the output `database_id` into wrangler.toml, then apply schema migration
npx wrangler d1 migrations apply gemini_exporter_vault_db --remote

# 3. Configure session signing secret (and optional access code)
openssl rand -base64 48 | npx wrangler secret put SESSION_HMAC_SECRET
# Optional: npx wrangler secret put SERVER_ACCESS_CODE

# 4. Deploy Worker
npx wrangler deploy
```
