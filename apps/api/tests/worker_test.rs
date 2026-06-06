use chrono::{Duration, Utc};
use share_me_api::worker;
mod common;

#[tokio::test]
async fn sweep_removes_expired_and_old_exhausted() {
    let (db, blob, _dir) = common::db_and_store().await;
    let now = Utc::now();
    // expired: expires_at is in the past
    common::seed_full(&db, &blob, "exp", None, Some(now - Duration::hours(1))).await;
    // valid: expires_at is in the future
    common::seed_full(&db, &blob, "ok", None, Some(now + Duration::hours(1))).await;

    let removed = worker::sweep_once(&db, &blob, 3600).await.unwrap();
    assert_eq!(removed, 1, "only the expired upload should be removed");
    // expired upload is gone
    assert!(
        db.get_header("exp", now).await.unwrap().is_none(),
        "expired upload should have no header"
    );
    // valid upload survives
    assert!(
        db.get_header("ok", now).await.unwrap().is_some(),
        "valid upload should still have a header"
    );
}
