#![allow(dead_code)]
use base64::Engine;
use chrono::Utc;
use share_me_api::{
    config::Config,
    db::{models::NewUpload, Db},
    routes::{build_router, AppState},
    storage::BlobStore,
    tokens,
};

// ── DB helpers (used by db/slot/resume tests) ────────────────────────────────

/// Create a fresh on-disk SQLite DB in a temp directory with migrations applied.
/// Uses on-disk (not :memory:) so the real WAL/busy path is exercised.
pub async fn fresh_db() -> (Db, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}/t.db", dir.path().display());
    let db = Db::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    // Return dir alongside db so the caller can keep it alive (drop = delete)
    (db, dir)
}

/// Insert a test upload row with has_blob = true (via mark_blob_written).
pub async fn seed(db: &Db, id: &str, max: Option<i64>) {
    let now = Utc::now();
    db.insert_upload(&NewUpload {
        id: id.into(),
        owner_token_hash: "o".into(),
        download_auth_hash: "d".into(),
        upload_token_hash: "u".into(),
        upload_token_expires_at: now,
        header: vec![1, 2, 3],
        storage_key: format!("k/{id}"),
        max_downloads: max,
        expires_at: None,
        unlock_at: None,
        created_at: now,
    })
    .await
    .unwrap();
    db.mark_blob_written(id, 100).await.unwrap();
}

// ── HTTP harness helpers (used by upload_download / health tests) ─────────────

/// Build a default test Config with PUBLIC_BASE_URL set so validation passes.
fn test_config(storage_local_path: String) -> Config {
    let mut cfg = Config::default();
    cfg.public_base_url = "http://localhost".into();
    cfg.storage_backend = "local".into();
    cfg.storage_local_path = storage_local_path;
    cfg
}

/// Build an AppState with a temp SQLite Db + local BlobStore in a tempdir.
/// Returns (AppState, TempDir) — caller must keep TempDir alive for the test.
pub async fn build_state() -> (AppState, tempfile::TempDir) {
    let blob_dir = tempfile::tempdir().unwrap();
    let cfg = test_config(blob_dir.path().to_string_lossy().into_owned());

    let db_dir = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}/t.db", db_dir.path().display());
    let db = Db::connect(&url).await.unwrap();
    db.migrate().await.unwrap();

    let blob = BlobStore::from_config(&cfg).unwrap();

    // Leak db_dir so the SQLite file lives for the lifetime of the test.
    // blob_dir is returned so callers can keep it alive.
    Box::leak(Box::new(db_dir));

    (AppState { db, blob, cfg }, blob_dir)
}

/// Returns a ready-to-use Router (tower::Service) for oneshot testing.
/// Keeps TempDir alive via Box::leak so the SQLite file and blobs persist.
pub async fn test_router() -> axum::Router {
    let (state, dir) = build_state().await;
    Box::leak(Box::new(dir)); // keep blob dir alive for test duration
    build_router(state)
}

/// Build AppState and also return the Db + BlobStore handles for direct
/// persistence assertions in upload_persists_blob.
pub async fn build_state_with_handles(
) -> (axum::Router, Db, BlobStore, tempfile::TempDir, tempfile::TempDir) {
    let blob_dir = tempfile::tempdir().unwrap();
    let cfg = test_config(blob_dir.path().to_string_lossy().into_owned());

    let db_dir = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}/t.db", db_dir.path().display());
    let db = Db::connect(&url).await.unwrap();
    db.migrate().await.unwrap();

    let blob = BlobStore::from_config(&cfg).unwrap();

    let state = AppState {
        db: db.clone(),
        blob: blob.clone(),
        cfg,
    };
    let router = build_router(state);
    (router, db, blob, db_dir, blob_dir)
}

/// Spawn a real TCP server on 127.0.0.1:0.
/// Returns (base_url, guard) — drop guard to stop accepting (the task keeps
/// running until the test process exits; acceptable for short tests).
pub async fn spawn_server() -> (String, tempfile::TempDir) {
    let (state, dir) = build_state().await;
    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base_url = format!("http://127.0.0.1:{}", addr.port());

    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service())
            .await
            .expect("server error");
    });

    (base_url, dir)
}

/// Build a minimal valid SHME header: "SHME" magic + 40 bytes of filler,
/// base64-std encoded (as the create endpoint expects).
/// Layout: MAGIC[0..4]=b"SHME", VERSION[4]=1, kdfType[5]=0, ...
pub fn header_b64() -> String {
    let mut h = b"SHME".to_vec();
    h.extend_from_slice(&[1u8; 40]); // VERSION=1, kdfType=1, rest are padding
    base64::engine::general_purpose::STANDARD.encode(h)
}

/// Build a SHME header with kdfType=0 at byte 5 (no password).
/// MAGIC[0..4]=b"SHME", VERSION[4]=1, kdfType[5]=0, ...
pub fn header_no_password_b64() -> String {
    let mut h = b"SHME".to_vec(); // bytes 0-3
    h.push(1); // VERSION byte 4
    h.push(0); // kdfType = 0 → no password (byte 5)
    h.extend_from_slice(&[0u8; 38]); // filler
    base64::engine::general_purpose::STANDARD.encode(h)
}

/// Build a SHME header with kdfType≠0 at byte 5 (has password).
/// MAGIC[0..4]=b"SHME", VERSION[4]=1, kdfType[5]=1, ...
pub fn header_with_password_b64() -> String {
    let mut h = b"SHME".to_vec(); // bytes 0-3
    h.push(1); // VERSION byte 4
    h.push(1); // kdfType = 1 → has password (byte 5)
    h.extend_from_slice(&[0u8; 38]); // filler
    base64::engine::general_purpose::STANDARD.encode(h)
}

/// SHA-256 hex of a token string — mirrors what the server stores as
/// download_auth_hash, so tests can supply the raw token as a bearer.
pub fn dl_hash(tok: &str) -> String {
    tokens::sha256_hex(tok)
}

/// POST /api/v1/uploads + PUT blob, returns the upload id.
/// Uses download_token as the raw download-auth bearer (dl_hash stored on
/// server = sha256_hex(download_token)).
pub async fn create_and_upload(
    base: &str,
    client: &reqwest::Client,
    max_downloads: Option<i64>,
    payload: &[u8],
    download_token: &str,
) -> String {
    let mut body = serde_json::json!({
        "header": header_b64(),
        "download_auth_hash": dl_hash(download_token),
    });
    if let Some(md) = max_downloads {
        body["max_downloads"] = serde_json::json!(md);
    }

    let resp = client
        .post(format!("{base}/api/v1/uploads"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "create failed");
    let v: serde_json::Value = resp.json().await.unwrap();
    let id = v["id"].as_str().unwrap().to_string();
    let upload_token = v["upload_token"].as_str().unwrap().to_string();

    let put = client
        .put(format!("{base}/api/v1/uploads/{id}/blob"))
        .bearer_auth(&upload_token)
        .body(payload.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), 204, "put blob failed");

    id
}

/// Like create_and_upload but with a custom header bytes (base64) and optional unlock_in_secs.
pub async fn create_and_upload_custom(
    base: &str,
    client: &reqwest::Client,
    header_b64_str: &str,
    max_downloads: Option<i64>,
    unlock_in_secs: Option<i64>,
    payload: &[u8],
    download_token: &str,
) -> String {
    let mut body = serde_json::json!({
        "header": header_b64_str,
        "download_auth_hash": dl_hash(download_token),
    });
    if let Some(md) = max_downloads {
        body["max_downloads"] = serde_json::json!(md);
    }
    if let Some(u) = unlock_in_secs {
        body["unlock_in_secs"] = serde_json::json!(u);
    }

    let resp = client
        .post(format!("{base}/api/v1/uploads"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "create failed");
    let v: serde_json::Value = resp.json().await.unwrap();
    let id = v["id"].as_str().unwrap().to_string();
    let upload_token = v["upload_token"].as_str().unwrap().to_string();

    let put = client
        .put(format!("{base}/api/v1/uploads/{id}/blob"))
        .bearer_auth(&upload_token)
        .body(payload.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), 204, "put blob failed");

    id
}

/// Variant of build_state_with_handles that also returns the owner_token from
/// a create call — used by Task 11 tests (Unit 5).  Exposed here so
/// tests/common/mod.rs stays the single source for helpers.
pub async fn create_and_upload_returning_owner(
    base: &str,
    client: &reqwest::Client,
    max_downloads: Option<i64>,
    payload: &[u8],
) -> (String, String) {
    let mut body = serde_json::json!({
        "header": header_b64(),
        "download_auth_hash": dl_hash("tok"),
    });
    if let Some(md) = max_downloads {
        body["max_downloads"] = serde_json::json!(md);
    }

    let resp = client
        .post(format!("{base}/api/v1/uploads"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "create failed");
    let v: serde_json::Value = resp.json().await.unwrap();
    let id = v["id"].as_str().unwrap().to_string();
    let upload_token = v["upload_token"].as_str().unwrap().to_string();
    let owner_token = v["owner_token"].as_str().unwrap().to_string();

    let put = client
        .put(format!("{base}/api/v1/uploads/{id}/blob"))
        .bearer_auth(&upload_token)
        .body(payload.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), 204, "put blob failed");

    (id, owner_token)
}

/// Returns (Db, BlobStore, TempDir-guard) for worker_test.
/// The TempDir keeps both the SQLite file and blob dir alive.
pub async fn db_and_store() -> (Db, BlobStore, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}/t.db", dir.path().display());
    let db = Db::connect(&url).await.unwrap();
    db.migrate().await.unwrap();

    let mut cfg = Config::default();
    cfg.public_base_url = "http://localhost".into();
    cfg.storage_backend = "local".into();
    cfg.storage_local_path = dir.path().join("blobs").to_string_lossy().into_owned();
    let blob = BlobStore::from_config(&cfg).unwrap();

    (db, blob, dir)
}

/// Seed an upload with has_blob=true and put a real blob object in the store.
/// Used by worker_test.
pub async fn seed_full(
    db: &Db,
    blob: &BlobStore,
    id: &str,
    max: Option<i64>,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
) {
    use axum::body::Body;
    let now = Utc::now();
    let storage_key = format!("blobs/{id}");
    db.insert_upload(&NewUpload {
        id: id.into(),
        owner_token_hash: "o".into(),
        download_auth_hash: "d".into(),
        upload_token_hash: "u".into(),
        upload_token_expires_at: now,
        header: b"SHME\x00\x00\x00\x00".to_vec(),
        storage_key: storage_key.clone(),
        max_downloads: max,
        expires_at,
        unlock_at: None,
        created_at: now,
    })
    .await
    .unwrap();
    blob.put_stream(&storage_key, Body::from(vec![0u8; 16]))
        .await
        .unwrap();
    db.mark_blob_written(id, 16).await.unwrap();
}
