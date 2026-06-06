CREATE TABLE uploads (
    id                      TEXT PRIMARY KEY,
    owner_token_hash        TEXT NOT NULL,
    download_auth_hash      TEXT NOT NULL,
    upload_token_hash       TEXT,
    upload_token_expires_at TIMESTAMPTZ,
    header                  BYTEA NOT NULL,
    storage_key             TEXT NOT NULL,
    size_cipher             BIGINT NOT NULL DEFAULT 0,
    has_blob                BOOLEAN NOT NULL DEFAULT FALSE,
    max_downloads           BIGINT,
    download_count          BIGINT NOT NULL DEFAULT 0,
    expires_at              TIMESTAMPTZ,
    last_claim_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL,
    CHECK (max_downloads IS NULL OR download_count <= max_downloads)
);
CREATE INDEX idx_uploads_expires_at ON uploads (expires_at);

CREATE TABLE download_claims (
    upload_id   TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    session_id  TEXT NOT NULL,
    claimed_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (upload_id, session_id)
);
