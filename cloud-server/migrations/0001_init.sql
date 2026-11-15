-- Zero-knowledge multi-tenant E2EE Vault schema for Cloudflare D1 (SQLite)
-- Zero PII: no plaintext emails, provider names, titles, or conversation IDs are stored.

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    token_epoch INTEGER NOT NULL DEFAULT 1,
    key_fingerprint TEXT,
    auth_verifier_hash TEXT,
    used_bytes INTEGER NOT NULL DEFAULT 0,
    quota_bytes INTEGER NOT NULL,
    next_seq INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_records (
    user_id TEXT NOT NULL,
    blind_record_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    change_seq INTEGER NOT NULL,
    byte_length INTEGER NOT NULL,
    sha256_hex TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, blind_record_id),
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vault_records_user_seq
    ON vault_records (user_id, change_seq ASC);
