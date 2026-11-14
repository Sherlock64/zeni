-- One random data key encrypts account fields. Each row here holds that key encrypted
-- (AES-256-GCM, nonce || ciphertext) under an Argon2id key derived from the master password
-- (one 'password' row) or from one recovery code (one 'recovery' row per unused code).
-- Argon2id params are stored per row so they can change later. Setup is done once the
-- 'password' row exists.
CREATE TABLE key_wraps (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('password', 'recovery')),
    salt BLOB NOT NULL,
    kdf_m_kib INTEGER NOT NULL,
    kdf_t INTEGER NOT NULL,
    kdf_p INTEGER NOT NULL,
    wrapped_key BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX key_wraps_one_password ON key_wraps (kind) WHERE kind = 'password';

-- account_number and routing_number are AES-256-GCM blobs (nonce || ciphertext) under the data key.
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    owner TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_number BLOB NOT NULL,
    routing_number BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
