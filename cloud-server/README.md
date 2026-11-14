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

## Deployment (5 Minutes, $0 Free Tier)
```bash
cd cloud-server

# 1. Create D1 database and R2 bucket
npx wrangler d1 create gemini_exporter_vault_db
npx wrangler r2 bucket create gemini-exporter-vault-blobs

# 2. Update database_id, GOOGLE_CLIENT_IDS, and ALLOWED_ORIGINS in wrangler.toml

# 3. Apply D1 schema migration
npx wrangler d1 migrations apply gemini_exporter_vault_db --remote

# 4. Configure high-entropy session signing secret
openssl rand -base64 48 | npx wrangler secret put SESSION_HMAC_SECRET

# 5. Deploy Worker
npx wrangler deploy
```
