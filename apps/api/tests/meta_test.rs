/// Tests for GET /api/v1/dl/{id}/meta (Task 2).
mod common;

#[tokio::test]
async fn meta_password_file_has_password_true() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();

    // Create a file with kdfType=1 at byte 5 (has_password=true)
    let id = common::create_and_upload_custom(
        &base,
        &client,
        &common::header_with_password_b64(),
        None,
        None,
        b"encrypted-data",
        "tok",
    )
    .await;

    let resp = client
        .get(format!("{base}/api/v1/dl/{id}/meta"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "meta must return 200");
    let v: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(v["has_password"], true, "has_password must be true (kdfType=1 at byte 5)");
    assert!(v["size_cipher"].as_i64().unwrap() > 0, "size_cipher must be > 0");
    assert_eq!(v["download_count"], 0, "download_count must be 0");
}

#[tokio::test]
async fn meta_no_password_file_has_password_false() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();

    // Create a file with kdfType=0 at byte 5 (has_password=false)
    let id = common::create_and_upload_custom(
        &base,
        &client,
        &common::header_no_password_b64(),
        None,
        None,
        b"plain-data",
        "tok",
    )
    .await;

    let resp = client
        .get(format!("{base}/api/v1/dl/{id}/meta"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "meta must return 200");
    let v: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(v["has_password"], false, "has_password must be false (kdfType=0 at byte 5)");
    assert!(v["size_cipher"].as_i64().unwrap() > 0, "size_cipher must be > 0");
    assert_eq!(v["download_count"], 0, "download_count must be 0");
}

#[tokio::test]
async fn meta_after_delete_returns_410() {
    let (base, _guard) = common::spawn_server().await;
    let client = reqwest::Client::new();

    // Create with owner token returned — need raw create to capture owner_token
    let body = serde_json::json!({
        "header": common::header_with_password_b64(),
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
    let id = v["id"].as_str().unwrap().to_string();
    let upload_token = v["upload_token"].as_str().unwrap().to_string();
    let owner_token = v["owner_token"].as_str().unwrap().to_string();

    // Upload blob
    let put = client
        .put(format!("{base}/api/v1/uploads/{id}/blob"))
        .bearer_auth(&upload_token)
        .body(b"data".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), 204);

    // Meta before delete → 200
    let m = client
        .get(format!("{base}/api/v1/dl/{id}/meta"))
        .send()
        .await
        .unwrap();
    assert_eq!(m.status(), 200, "meta before delete must return 200");

    // Delete
    let d = client
        .delete(format!("{base}/api/v1/uploads/{id}"))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap();
    assert_eq!(d.status(), 204, "delete must return 204");

    // Meta after delete → 410
    let m2 = client
        .get(format!("{base}/api/v1/dl/{id}/meta"))
        .send()
        .await
        .unwrap();
    assert_eq!(m2.status(), 410, "meta after delete must return 410");
}
