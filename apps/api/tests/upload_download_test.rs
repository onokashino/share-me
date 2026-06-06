use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;
mod common;

// ── oneshot tests (no real server needed) ─────────────────────────────────────

#[tokio::test]
async fn create_returns_tokens() {
    let app = common::test_router().await;
    let body = serde_json::json!({
        "header": common::header_b64(),
        "download_auth_hash": "ab".repeat(32),
        "max_downloads": 1,
        "expires_in_secs": 3600
    });
    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/uploads")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(v["id"].as_str().unwrap().len() >= 10, "id should be non-trivially long");
    assert!(!v["owner_token"].as_str().unwrap().is_empty(), "owner_token must be present");
    assert!(!v["upload_token"].as_str().unwrap().is_empty(), "upload_token must be present");
}

#[tokio::test]
async fn create_rejects_bad_header() {
    use base64::Engine;
    let app = common::test_router().await;
    let body = serde_json::json!({
        "header": base64::engine::general_purpose::STANDARD.encode(b"nope"),
        "download_auth_hash": "00"
    });
    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/uploads")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

// ── real-server tests ──────────────────────────────────────────────────────────

/// Upload blob via real TCP server, then assert persistence:
///   1. auth_row shows upload_token_hash is now NULL (single-use cleared)
///   2. BlobStore.get_stream returns the exact bytes
/// Does NOT call GET /dl/... (stubbed until Unit 5).
#[tokio::test]
async fn upload_persists_blob() {
    use futures_util::TryStreamExt;

    let (router, db, blob, _db_dir, _blob_dir) = common::build_state_with_handles().await;

    // Spawn real server
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://127.0.0.1:{}", addr.port());
    tokio::spawn(async move {
        axum::serve(listener, router.into_make_service())
            .await
            .expect("server error");
    });

    let client = reqwest::Client::new();
    let payload = vec![42u8; 50_000];
    let id = common::create_and_upload(&base, &client, None, &payload, "tok").await;

    // Assert 1: upload_token_hash is NULL (single-use token cleared after blob write)
    let row = db.auth_row(&id).await.unwrap().expect("row must exist");
    let (_owner, _dl, upload_hash, _exp) = row;
    assert!(
        upload_hash.is_none(),
        "upload_token_hash must be NULL after successful PUT blob"
    );

    // Assert 2: BlobStore has the exact bytes we uploaded
    let key = format!("blobs/{id}");
    let mut stream = blob.get_stream(&key).await.expect("blob must exist in store");
    let mut got = Vec::new();
    while let Some(chunk) = stream.try_next().await.unwrap() {
        got.extend_from_slice(&chunk);
    }
    assert_eq!(got, payload, "stored bytes must match uploaded payload");
}

/// PUT with a wrong upload token → 401.
#[tokio::test]
async fn upload_with_bad_token_is_unauthorized() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();

    // Create (get a valid id but ignore its upload_token)
    let body = serde_json::json!({
        "header": common::header_b64(),
        "download_auth_hash": common::dl_hash("tok"),
    });
    let resp = client
        .post(format!("{base}/api/v1/uploads"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let v: serde_json::Value = resp.json().await.unwrap();
    let id = v["id"].as_str().unwrap();

    // PUT with a wrong token
    let put = client
        .put(format!("{base}/api/v1/uploads/{id}/blob"))
        .bearer_auth("totally-wrong-token")
        .body(b"data".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), 401);
}

// ── Task 10 tests ─────────────────────────────────────────────────────────────

/// Full roundtrip: create + upload, GET /dl/{id} header → 200, GET /dl/{id}/blob → 200.
#[tokio::test]
async fn upload_then_download_roundtrip() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();
    let payload = vec![7u8; 10_000];
    let id = common::create_and_upload(&base, &client, None, &payload, "tok").await;

    // Header endpoint — ungated
    let hdr = client
        .get(format!("{base}/api/v1/dl/{id}"))
        .send()
        .await
        .unwrap();
    assert_eq!(hdr.status(), 200, "header endpoint must return 200");

    // Blob endpoint — gated by download-auth token + session header
    let blob = client
        .get(format!("{base}/api/v1/dl/{id}/blob"))
        .bearer_auth("tok")
        .header("x-download-session", "s1")
        .send()
        .await
        .unwrap();
    assert_eq!(blob.status(), 200, "blob endpoint must return 200");
    let got = blob.bytes().await.unwrap();
    assert_eq!(got.as_ref(), payload.as_slice(), "returned bytes must match uploaded payload");
}

/// max_downloads=1: first session → 200; same session again → 200 (resume); different session → 410.
#[tokio::test]
async fn burn_after_read_blocks_second_session_but_allows_resume() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();
    let id = common::create_and_upload(&base, &client, Some(1), b"data", "tok").await;

    // First session claims
    let a = client
        .get(format!("{base}/api/v1/dl/{id}/blob"))
        .bearer_auth("tok")
        .header("x-download-session", "sess")
        .send()
        .await
        .unwrap();
    assert_eq!(a.status(), 200, "first session must return 200");

    // Same session resumes → 200
    let b = client
        .get(format!("{base}/api/v1/dl/{id}/blob"))
        .bearer_auth("tok")
        .header("x-download-session", "sess")
        .send()
        .await
        .unwrap();
    assert_eq!(b.status(), 200, "same session resume must return 200");

    // Different session → 410 (slot exhausted)
    let c = client
        .get(format!("{base}/api/v1/dl/{id}/blob"))
        .bearer_auth("tok")
        .header("x-download-session", "other")
        .send()
        .await
        .unwrap();
    assert_eq!(c.status(), 410, "different session after exhaustion must return 410");
}

/// Wrong bearer token on the blob endpoint → 401.
#[tokio::test]
async fn wrong_download_token_is_unauthorized() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();
    let id = common::create_and_upload(&base, &client, None, b"data", "tok").await;

    let r = client
        .get(format!("{base}/api/v1/dl/{id}/blob"))
        .bearer_auth("wrong-token")
        .header("x-download-session", "s")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401, "wrong download token must return 401");
}

/// Correct token but missing x-download-session header → 400.
#[tokio::test]
async fn missing_session_is_bad_request() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();
    let id = common::create_and_upload(&base, &client, None, b"data", "tok").await;

    let r = client
        .get(format!("{base}/api/v1/dl/{id}/blob"))
        .bearer_auth("tok")
        // deliberately omit x-download-session
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400, "missing session header must return 400");
}

// ── Task 11 tests ─────────────────────────────────────────────────────────────

/// Owner reads status (200, download_count=0), wrong owner → 404, delete → 204, header → 410.
#[tokio::test]
async fn owner_status_and_delete() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();
    let (id, owner) =
        common::create_and_upload_returning_owner(&base, &client, Some(2), b"x").await;

    // Status with correct owner token
    let s = client
        .get(format!("{base}/api/v1/uploads/{id}/status"))
        .bearer_auth(&owner)
        .send()
        .await
        .unwrap();
    assert_eq!(s.status(), 200, "status with valid owner must return 200");
    let v: serde_json::Value = s.json().await.unwrap();
    assert_eq!(v["download_count"], 0, "download_count must be 0 before any downloads");

    // Wrong owner token → 404
    let bad = client
        .get(format!("{base}/api/v1/uploads/{id}/status"))
        .bearer_auth("nope")
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), 404, "wrong owner token must return 404");

    // Delete
    let d = client
        .delete(format!("{base}/api/v1/uploads/{id}"))
        .bearer_auth(&owner)
        .send()
        .await
        .unwrap();
    assert_eq!(d.status(), 204, "delete must return 204");

    // Header after delete → 410
    let hdr = client
        .get(format!("{base}/api/v1/dl/{id}"))
        .send()
        .await
        .unwrap();
    assert_eq!(hdr.status(), 410, "header after delete must return 410");
}

/// After a successful upload (token cleared), a second PUT returns 410 Gone.
#[tokio::test]
async fn second_upload_with_cleared_token_is_gone() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();

    // Create
    let body = serde_json::json!({
        "header": common::header_b64(),
        "download_auth_hash": common::dl_hash("tok"),
    });
    let resp = client
        .post(format!("{base}/api/v1/uploads"))
        .json(&body)
        .send()
        .await
        .unwrap();
    let v: serde_json::Value = resp.json().await.unwrap();
    let id = v["id"].as_str().unwrap().to_string();
    let upload_token = v["upload_token"].as_str().unwrap().to_string();

    // First PUT — should succeed (204)
    let first = client
        .put(format!("{base}/api/v1/uploads/{id}/blob"))
        .bearer_auth(&upload_token)
        .body(b"hello".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 204);

    // Second PUT with the same token — upload_token_hash is now NULL → 410
    let second = client
        .put(format!("{base}/api/v1/uploads/{id}/blob"))
        .bearer_auth(&upload_token)
        .body(b"again".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(second.status(), 410);
}
