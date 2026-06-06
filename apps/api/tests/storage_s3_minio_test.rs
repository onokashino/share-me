// MinIO S3 integration test.
// Requires a running Docker daemon.  Skipped by default via #[ignore].
// Run explicitly with:  cargo test storage_s3_minio -- --ignored

use axum::body::Body;
use aws_config::BehaviorVersion;
use aws_sdk_s3::config::Credentials;
use futures_util::TryStreamExt;
use share_me_api::{config::Config, storage::BlobStore};
use testcontainers_modules::{minio::MinIO, testcontainers::runners::AsyncRunner};

#[tokio::test]
#[ignore = "requires docker (MinIO)"]
async fn storage_s3_minio_roundtrip() {
    // ── 1. Start MinIO container ──────────────────────────────────────────────
    let node = MinIO::default().start().await.expect("start MinIO container");
    let port = node
        .get_host_port_ipv4(9000)
        .await
        .expect("get MinIO port");
    let endpoint = format!("http://127.0.0.1:{port}");

    // ── 2. Create bucket via aws-sdk-s3 (object_store does NOT create buckets) ─
    let creds = Credentials::new("minioadmin", "minioadmin", None, None, "minio");
    let sdk_cfg = aws_config::defaults(BehaviorVersion::latest())
        .region("us-east-1")
        .credentials_provider(creds)
        .endpoint_url(&endpoint)
        .load()
        .await;
    let s3_client = aws_sdk_s3::Client::new(&sdk_cfg);

    // MinIO path-style: force_path_style must be set on the sdk config or
    // via the custom endpoint.  The aws-sdk-s3 v1 client auto-uses path-style
    // when a custom endpoint is provided.
    let bucket = "test-bucket";
    s3_client
        .create_bucket()
        .bucket(bucket)
        .send()
        .await
        .expect("create bucket");

    // ── 3. Build BlobStore pointing at MinIO ──────────────────────────────────
    let mut cfg = Config::default();
    cfg.public_base_url = "http://localhost".into();
    cfg.storage_backend = "s3".into();
    cfg.s3_bucket = bucket.into();
    cfg.s3_access_key = "minioadmin".into();
    cfg.s3_secret_key = "minioadmin".into();
    cfg.s3_region = Some("us-east-1".into());
    cfg.s3_endpoint = Some(endpoint.clone());

    let store = BlobStore::from_config(&cfg).expect("build BlobStore");

    // ── 4. Round-trip: put_stream → get_stream → delete ───────────────────────
    let payload = b"hello minio from share-me".to_vec();
    let key = "test/hello.bin";

    // put_stream
    let written = store
        .put_stream(key, Body::from(payload.clone()))
        .await
        .expect("put_stream");
    assert_eq!(written, payload.len() as u64, "written bytes must match payload length");

    // get_stream — collect all chunks
    let mut stream = store.get_stream(key).await.expect("get_stream");
    let mut got: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.try_next().await.expect("stream read") {
        got.extend_from_slice(&chunk);
    }
    assert_eq!(got, payload, "retrieved bytes must match uploaded payload");

    // delete
    store.delete(key).await.expect("delete");

    // confirm deletion: get_stream should now error
    let get_result = store.get_stream(key).await;
    assert!(
        get_result.is_err(),
        "get_stream after delete must return an error"
    );
}
