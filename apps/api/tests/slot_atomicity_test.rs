mod common;

use chrono::Utc;
use share_me_api::db::models::ClaimOutcome;

#[tokio::test]
async fn exactly_k_of_n_claims_succeed() {
    let (db, _dir) = common::fresh_db().await;
    common::seed(&db, "abc", Some(3)).await;
    let mut handles = vec![];
    for i in 0..10 {
        let db = db.clone();
        handles.push(tokio::spawn(async move {
            matches!(
                db.claim_or_resume("abc", &format!("s{i}"), Utc::now())
                    .await
                    .unwrap(),
                ClaimOutcome::Streamed(_)
            )
        }));
    }
    let mut ok = 0;
    for h in handles {
        if h.await.unwrap() {
            ok += 1;
        }
    }
    assert_eq!(ok, 3, "exactly max_downloads slots may be claimed");
}
