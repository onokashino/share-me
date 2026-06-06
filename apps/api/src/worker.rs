use crate::{db::Db, storage::BlobStore};
use chrono::{Duration, Utc};
use std::time::Duration as StdDuration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

pub async fn sweep_once(db: &Db, blob: &BlobStore, resume_ttl_secs: i64) -> anyhow::Result<usize> {
    let now = Utc::now();
    let resume_cutoff = now - Duration::seconds(resume_ttl_secs);
    let doomed = db.query_doomed(now, resume_cutoff).await?;
    let mut removed = 0;
    for (id, storage_key) in &doomed {
        if let Err(e) = blob.delete(storage_key).await {
            tracing::warn!(%id, error = %e, "blob delete failed; will retry next sweep");
            continue;
        }
        db.delete_row(id).await?;
        removed += 1;
    }
    Ok(removed)
}

pub async fn expiry_worker(
    db: Db,
    blob: BlobStore,
    resume_ttl_secs: i64,
    period: StdDuration,
    token: CancellationToken,
) {
    let mut ticker = interval(period);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = token.cancelled() => {
                tracing::info!("expiry worker shutting down");
                break;
            }
            _ = ticker.tick() => {
                if let Err(e) = sweep_once(&db, &blob, resume_ttl_secs).await {
                    tracing::error!(error = %e, "expiry sweep failed");
                }
            }
        }
    }
}
