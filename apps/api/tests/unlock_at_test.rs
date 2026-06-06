/// Tests for server-enforced unlock_at / timed release (Task 3).
mod common;

/// Create with unlock_in_secs far in the future → GET /dl/{id}/blob → 423 Locked.
/// download_count stays 0, /meta shows unlock_at.
#[tokio::test]
async fn locked_file_returns_423() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();

    // unlock_in_secs = 3600 (1 hour from now = locked)
    let id = common::create_and_upload_custom(
        &base,
        &client,
        &common::header_no_password_b64(),
        None,
        Some(3600), // locked for 1 hour
        b"locked-payload",
        "tok",
    )
    .await;

    // GET /dl/{id}/blob with valid auth → 423 Locked
    let blob = client
        .get(format!("{base}/api/v1/dl/{id}/blob"))
        .bearer_auth("tok")
        .header("x-download-session", "s1")
        .send()
        .await
        .unwrap();
    assert_eq!(blob.status(), 423, "locked file must return 423");

    // /meta shows unlock_at is set
    let meta = client
        .get(format!("{base}/api/v1/dl/{id}/meta"))
        .send()
        .await
        .unwrap();
    assert_eq!(meta.status(), 200, "meta must return 200 for locked file");
    let v: serde_json::Value = meta.json().await.unwrap();
    assert!(
        v["unlock_at"].as_str().is_some(),
        "unlock_at must be present in meta for a locked file"
    );
    assert_eq!(v["download_count"], 0, "download_count must be 0 (locked, not claimed)");
}

/// Create with no unlock_in_secs → blob works (200).
#[tokio::test]
async fn unlocked_file_blob_returns_200() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();

    let id = common::create_and_upload_custom(
        &base,
        &client,
        &common::header_no_password_b64(),
        None,
        None, // no lock
        b"open-payload",
        "tok",
    )
    .await;

    let blob = client
        .get(format!("{base}/api/v1/dl/{id}/blob"))
        .bearer_auth("tok")
        .header("x-download-session", "s1")
        .send()
        .await
        .unwrap();
    assert_eq!(blob.status(), 200, "unlocked file must return 200");
}

/// Create with unlock_in_secs=0 (past/immediate) → blob works (200).
#[tokio::test]
async fn past_unlock_at_blob_returns_200() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();

    // unlock_in_secs=0 means unlock_at = now → should be immediately available
    // (unlock_at <= now condition satisfied)
    let id = common::create_and_upload_custom(
        &base,
        &client,
        &common::header_no_password_b64(),
        None,
        Some(0), // unlock_at = now (immediately available)
        b"past-unlock-payload",
        "tok",
    )
    .await;

    // Small sleep to ensure unlock_at is strictly in the past
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    let blob = client
        .get(format!("{base}/api/v1/dl/{id}/blob"))
        .bearer_auth("tok")
        .header("x-download-session", "s1")
        .send()
        .await
        .unwrap();
    assert_eq!(blob.status(), 200, "file with past unlock_at must return 200");
}
