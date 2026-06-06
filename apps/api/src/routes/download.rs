use crate::{db::models::ClaimOutcome, error::*, routes::AppState, tokens};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    Json,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use chrono::Utc;
use futures_util::TryStreamExt;
use serde::Serialize;

/// GET /api/v1/dl/{id} — ungated; returns the SHME header bytes or 410.
pub async fn header(
    Path(id): Path<String>,
    State(st): State<AppState>,
) -> AppResult<Response> {
    match st.db.get_header(&id, Utc::now()).await? {
        Some(bytes) => Ok(Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .header(header::REFERRER_POLICY, "no-referrer")
            .body(Body::from(bytes))
            .unwrap()),
        None => Err(AppError::Gone),
    }
}

/// GET /api/v1/dl/{id}/blob — gated by download-auth bearer token; claims + streams.
pub async fn blob(
    Path(id): Path<String>,
    State(st): State<AppState>,
    TypedHeader(auth): TypedHeader<Authorization<Bearer>>,
    headers: HeaderMap,
) -> AppResult<Response> {
    // Authenticate: constant-time compare of stored download_auth_hash vs sha256(token)
    let row = st.db.auth_row(&id).await?.ok_or(AppError::Gone)?;
    let (_owner, download_auth_hash, _upload_hash, _upload_exp) = row;
    if !tokens::hash_eq(&download_auth_hash, &tokens::sha256_hex(auth.token())) {
        return Err(AppError::Unauthorized);
    }

    // Session header required
    let session = headers
        .get("x-download-session")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::BadRequest("missing x-download-session".into()))?
        .to_string();

    // Cheap pre-check for unlock_at: gives 423 Locked instead of 410 Gone for a timed-release file.
    // The authoritative gate is inside claim_or_resume (single conditional UPDATE).
    if let Some(unlock_at) = st.db.unlock_at(&id).await? {
        if unlock_at > Utc::now() {
            return Err(AppError::Locked);
        }
    }

    // Atomic claim-or-resume
    let ok = match st.db.claim_or_resume(&id, &session, Utc::now()).await? {
        ClaimOutcome::Streamed(ok) => ok,
        ClaimOutcome::Gone => return Err(AppError::Gone),
    };

    // Stream blob from object store — no buffering
    let stream = st
        .blob
        .get_stream(&ok.storage_key)
        .await
        .map_err(AppError::Storage)?;
    let mapped = stream.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e));

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_LENGTH, ok.size_cipher)
        .header(header::REFERRER_POLICY, "no-referrer")
        .body(Body::from_stream(mapped))
        .unwrap())
}

// ── GET /api/v1/dl/{id}/meta ─────────────────────────────────────────────────

#[derive(Serialize)]
pub struct MetaResp {
    pub has_password: bool,
    pub size_cipher: i64,
    pub max_downloads: Option<i64>,
    pub download_count: i64,
    pub expires_at: Option<String>,
    pub unlock_at: Option<String>,
}

/// GET /api/v1/dl/{id}/meta — public lifecycle JSON; no auth required.
pub async fn meta(
    Path(id): Path<String>,
    State(st): State<AppState>,
) -> AppResult<Json<MetaResp>> {
    let row = st.db.public_meta(&id, Utc::now()).await?.ok_or(AppError::Gone)?;
    // kdfType is at byte index 5 of the SHME header:
    // MAGIC[0..4], VERSION[4], kdfType[5], ...
    let has_password = row.header.get(5).copied().unwrap_or(0) != 0;
    Ok(Json(MetaResp {
        has_password,
        size_cipher: row.size_cipher,
        max_downloads: row.max_downloads,
        download_count: row.download_count,
        expires_at: row.expires_at.map(|t| t.to_rfc3339()),
        unlock_at: row.unlock_at.map(|t| t.to_rfc3339()),
    }))
}
