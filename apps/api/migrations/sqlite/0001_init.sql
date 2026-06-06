CREATE TABLE uploads (
    id                      TEXT PRIMARY KEY,
    owner_token_hash        TEXT NOT NULL,
    download_auth_hash      TEXT NOT NULL,
    upload_token_hash       TEXT,
    upload_token_expires_at TEXT,
    header                  BLOB NOT NULL,
    storage_key             TEXT NOT NULL,
    size_cipher             INTEGER NOT NULL DEFAULT 0,
    has_blob                INTEGER NOT NULL DEFAULT 0,
    max_downloads           INTEGER,
    download_count          INTEGER NOT NULL DEFAULT 0,
    expires_at              TEXT,
    last_claim_at           TEXT,
    created_at              TEXT NOT NULL,
    CHECK (max_downloads IS NULL OR download_count <= max_downloads)
);
CREATE INDEX idx_uploads_expires_at ON uploads (expires_at);

CREATE TABLE download_claims (
    upload_id   TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    claimed_at  TEXT NOT NULL,
    PRIMARY KEY (upload_id, session_id),
    FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE
);
