mod common;

use chrono::Utc;
use share_me_api::db::models::ClaimOutcome;

#[tokio::test]
async fn same_session_resumes_without_burning_a_slot() {
    // A multi-download drop (NOT burn): the same session may resume the stream
    // without consuming a second slot.
    let (db, _dir) = common::fresh_db().await;
    common::seed(&db, "x", Some(2)).await;
    let now = Utc::now();

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
        "same-session resume should succeed for a multi-download drop"
    );

    // A different session consumes the remaining slot.
    assert!(
        matches!(
            db.claim_or_resume("x", "other", now).await.unwrap(),
            ClaimOutcome::Streamed(_)
        ),
        "second distinct session should consume the remaining slot"
    );

    // Now exhausted (2/2): a third distinct session is denied.
    assert!(
        matches!(
            db.claim_or_resume("x", "third", now).await.unwrap(),
            ClaimOutcome::Gone
        ),
        "third distinct session after exhaustion should be Gone"
    );
}

#[tokio::test]
async fn burn_is_strictly_one_time_with_no_resume() {
    // max_downloads == 1 (burn-after-read): the content is delivered exactly
    // once; even the SAME session cannot re-download it.
    let (db, _dir) = common::fresh_db().await;
    common::seed(&db, "b", Some(1)).await;
    let now = Utc::now();

    assert!(
        matches!(
            db.claim_or_resume("b", "sess", now).await.unwrap(),
            ClaimOutcome::Streamed(_)
        ),
        "first claim should succeed"
    );

    // Same session re-download of a burn drop must be denied (no resume).
    assert!(
        matches!(
            db.claim_or_resume("b", "sess", now).await.unwrap(),
            ClaimOutcome::Gone
        ),
        "same-session re-download of a burn drop must be Gone"
    );

    // A different session is denied too.
    assert!(
        matches!(
            db.claim_or_resume("b", "other", now).await.unwrap(),
            ClaimOutcome::Gone
        ),
        "different session after burn should be Gone"
    );
}
