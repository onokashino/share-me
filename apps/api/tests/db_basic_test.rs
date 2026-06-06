use share_me_api::db::Db;

#[tokio::test]
async fn connect_and_migrate_sqlite_memory() {
    // file-backed temp DB exercises the real WAL/busy path
    let dir = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}/t.db", dir.path().display());
    let db = Db::connect(&url).await.expect("connect");
    db.migrate().await.expect("migrate");
}
