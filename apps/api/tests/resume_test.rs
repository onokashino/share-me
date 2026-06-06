mod common;

use chrono::Utc;
use share_me_api::db::models::ClaimOutcome;

#[tokio::test]
async fn same_session_resumes_without_burning_a_second_slot() {
    let (db, _dir) = common::fresh_db().await;
    common::seed(&db, "x", Some(1)).await;
    let now = Utc::now();

    // First claim: consumes the one slot.
    assert!(
        matches!(
            db.claim_or_resume("x", "sess", now).await.unwrap(),
            ClaimOutcome::Streamed(_)
        ),
        "first claim should succeed"
    );

    // Same session resumes — must not burn a second slot.
    assert!(
        matches!(
            db.claim_or_resume("x", "sess", now).await.unwrap(),
            ClaimOutcome::Streamed(_)
        ),
        "same-session resume should succeed"
    );

    // A different session is denied (max_downloads=1 already claimed).
    assert!(
        matches!(
            db.claim_or_resume("x", "other", now).await.unwrap(),
            ClaimOutcome::Gone
        ),
        "different session after exhaustion should be Gone"
    );
}
