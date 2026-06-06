use axum::body::Body;
use futures_util::TryStreamExt;
use share_me_api::{config::Config, storage::BlobStore};

#[tokio::test]
async fn local_put_get_delete_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = Config::default();
    cfg.storage_backend = "local".into();
    cfg.storage_local_path = dir.path().to_string_lossy().into_owned();
    let store = BlobStore::from_config(&cfg).unwrap();

    let data = vec![7u8; 5000];
    let n = store.put_stream("a/b", Body::from(data.clone())).await.unwrap();
    assert_eq!(n, 5000);

    let mut s = store.get_stream("a/b").await.unwrap();
    let mut got = Vec::new();
    while let Some(chunk) = s.try_next().await.unwrap() { got.extend_from_slice(&chunk); }
    assert_eq!(got, data);

    store.delete("a/b").await.unwrap();
    assert!(store.get_stream("a/b").await.is_err());
}
