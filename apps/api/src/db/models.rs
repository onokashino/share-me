use chrono::{DateTime, Utc};

#[derive(Debug, Clone)]
pub struct NewUpload {
    pub id: String,
    pub owner_token_hash: String,
    pub download_auth_hash: String,
    pub upload_token_hash: String,
    pub upload_token_expires_at: DateTime<Utc>,
    pub header: Vec<u8>,
    pub storage_key: String,
    pub max_downloads: Option<i64>,
    pub expires_at: Option<DateTime<Utc>>,
    pub unlock_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Returned by a successful claim: enough to stream the blob.
#[derive(Debug, Clone)]
pub struct ClaimOk {
    pub storage_key: String,
    pub size_cipher: i64,
}

#[derive(Debug)]
pub enum ClaimOutcome {
    Streamed(ClaimOk), // claimed a new slot, or resumed an existing session
    Gone,              // expired / exhausted / missing
}

#[derive(Debug, Clone)]
pub struct HeaderRow {
    pub header: Vec<u8>,
    pub has_password: bool, // derived elsewhere; header is opaque to server
}

#[derive(Debug, Clone)]
pub struct StatusRow {
    pub download_count: i64,
    pub max_downloads: Option<i64>,
    pub expires_at: Option<DateTime<Utc>>,
    pub unlock_at: Option<DateTime<Utc>>,
    pub size_cipher: i64,
    pub created_at: DateTime<Utc>,
}

/// Returned by Db::public_meta — used for GET /api/v1/dl/{id}/meta.
#[derive(Debug, Clone)]
pub struct PublicMetaRow {
    pub header: Vec<u8>,
    pub size_cipher: i64,
    pub max_downloads: Option<i64>,
    pub download_count: i64,
    pub expires_at: Option<DateTime<Utc>>,
    pub unlock_at: Option<DateTime<Utc>>,
}
