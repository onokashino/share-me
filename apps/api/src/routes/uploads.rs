use crate::{db::models::NewUpload, error::*, routes::AppState, tokens};
use axum::{
    body::Body,
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use base64::Engine;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

// ── POST /api/v1/uploads ─────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateReq {
    pub header: String,             // base64-std of the SHME header bytes
    pub download_auth_hash: String, // hex SHA-256 of the client's download-auth token
    pub max_downloads: Option<i64>,
    pub expires_in_secs: Option<i64>,
    pub unlock_in_secs: Option<i64>, // if set, file is locked until now+unlock_in_secs
}

#[derive(Serialize)]
pub struct CreateResp {
    pub id: String,
    pub owner_token: String,
    pub upload_token: String,
}

pub async fn create(
    State(st): State<AppState>,
    Json(req): Json<CreateReq>,
) -> AppResult<Json<CreateResp>> {
    // Decode + validate header bytes
    let header = base64::engine::general_purpose::STANDARD
        .decode(req.header.as_bytes())
        .map_err(|_| AppError::BadRequest("header not base64".into()))?;
    if header.len() < 4 || &header[0..4] != b"SHME" {
        return Err(AppError::BadRequest("header missing SHME magic".into()));
    }

    // Validate max_downloads
    if let Some(md) = req.max_downloads {
        if md <= 0 {
            return Err(AppError::BadRequest("max_downloads must be > 0".into()));
        }
        if let Some(cap) = st.cfg.max_downloads_cap {
            if md > cap {
                return Err(AppError::BadRequest("max_downloads exceeds cap".into()));
            }
        }
    }

    let now = Utc::now();
    let ttl = req
        .expires_in_secs
        .unwrap_or(st.cfg.default_expiry_secs)
        .clamp(1, st.cfg.max_expiry_secs);
    let expires_at = Some(now + Duration::seconds(ttl));

    let unlock_at = req.unlock_in_secs.map(|s| now + Duration::seconds(s));

    let id = tokens::new_id();
    let owner_token = tokens::gen_token();
    let upload_token = tokens::gen_token();
    let storage_key = format!("blobs/{id}");

    st.db
        .insert_upload(&NewUpload {
            id: id.clone(),
            owner_token_hash: tokens::sha256_hex(&owner_token),
            download_auth_hash: req.download_auth_hash,
            upload_token_hash: tokens::sha256_hex(&upload_token),
            upload_token_expires_at: now + Duration::seconds(st.cfg.upload_token_ttl_secs),
            header,
            storage_key,
            max_downloads: req.max_downloads,
            expires_at,
            unlock_at,
            created_at: now,
        })
        .await?;

    Ok(Json(CreateResp {
        id,
        owner_token,
        upload_token,
    }))
}

// ── PUT /api/v1/uploads/{id}/blob ────────────────────────────────────────────

pub async fn put_blob(
    Path(id): Path<String>,
    State(st): State<AppState>,
    // TypedHeader must come before body (body extractor must be last)
    TypedHeader(auth): TypedHeader<Authorization<Bearer>>,
    body: Body,
) -> AppResult<StatusCode> {
    let row = st.db.auth_row(&id).await?.ok_or(AppError::NotFound)?;
    let (_owner, _dl, upload_hash, upload_exp) = row;

    // upload_token_hash being NULL means the blob was already uploaded (single-use cleared)
    let upload_hash = upload_hash.ok_or(AppError::Gone)?;

    // Check TTL
    if let Some(exp) = upload_exp {
        if exp <= Utc::now() {
            return Err(AppError::Gone);
        }
    }

    // Constant-time compare
    if !tokens::hash_eq(&upload_hash, &tokens::sha256_hex(auth.token())) {
        return Err(AppError::Unauthorized);
    }

    let storage_key = format!("blobs/{id}");
    let written = st
        .blob
        .put_stream(&storage_key, body)
        .await
        .map_err(|e| AppError::Other(e))?;
    st.db.mark_blob_written(&id, written as i64).await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── GET /api/v1/uploads/{id}/status ─────────────────────────────────────────

#[derive(Serialize)]
pub struct StatusResp {
    pub download_count: i64,
    pub max_downloads: Option<i64>,
    pub expires_at: Option<String>,
    pub unlock_at: Option<String>,
    pub size_cipher: i64,
    pub created_at: String,
}

pub async fn status(
    Path(id): Path<String>,
    State(st): State<AppState>,
    TypedHeader(auth): TypedHeader<Authorization<Bearer>>,
) -> AppResult<Json<StatusResp>> {
    let owner_hash = tokens::sha256_hex(auth.token());
    let row = st.db.status(&id, &owner_hash).await?.ok_or(AppError::NotFound)?;
    Ok(Json(StatusResp {
        download_count: row.download_count,
        max_downloads: row.max_downloads,
        expires_at: row.expires_at.map(|t| t.to_rfc3339()),
        unlock_at: row.unlock_at.map(|t| t.to_rfc3339()),
        size_cipher: row.size_cipher,
        created_at: row.created_at.to_rfc3339(),
    }))
}

// ── DELETE /api/v1/uploads/{id} ───────────────────────────────────────────────

pub async fn delete(
    Path(id): Path<String>,
    State(st): State<AppState>,
    TypedHeader(auth): TypedHeader<Authorization<Bearer>>,
) -> AppResult<StatusCode> {
    let owner_hash = tokens::sha256_hex(auth.token());
    match st.db.delete_by_owner(&id, &owner_hash).await? {
        Some(storage_key) => {
            let _ = st.blob.delete(&storage_key).await; // best-effort
            Ok(StatusCode::NO_CONTENT)
        }
        None => Err(AppError::NotFound),
    }
}
