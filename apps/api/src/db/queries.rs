use crate::db::models::*;
use crate::db::Db;
use chrono::{DateTime, Utc};
use sqlx::Row;

impl Db {
    pub async fn insert_upload(&self, u: &NewUpload) -> anyhow::Result<()> {
        match self {
            Db::Sqlite(p) => {
                sqlx::query(
                    "INSERT INTO uploads (id, owner_token_hash, download_auth_hash, upload_token_hash, \
                     upload_token_expires_at, header, storage_key, max_downloads, expires_at, unlock_at, created_at) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                )
                .bind(&u.id).bind(&u.owner_token_hash).bind(&u.download_auth_hash)
                .bind(&u.upload_token_hash).bind(u.upload_token_expires_at)
                .bind(&u.header).bind(&u.storage_key).bind(u.max_downloads)
                .bind(u.expires_at).bind(u.unlock_at).bind(u.created_at)
                .execute(p).await?;
                Ok(())
            }
            Db::Postgres(p) => {
                sqlx::query(
                    "INSERT INTO uploads (id, owner_token_hash, download_auth_hash, upload_token_hash, \
                     upload_token_expires_at, header, storage_key, max_downloads, expires_at, unlock_at, created_at) \
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
                )
                .bind(&u.id).bind(&u.owner_token_hash).bind(&u.download_auth_hash)
                .bind(&u.upload_token_hash).bind(u.upload_token_expires_at)
                .bind(&u.header).bind(&u.storage_key).bind(u.max_downloads)
                .bind(u.expires_at).bind(u.unlock_at).bind(u.created_at)
                .execute(p).await?;
                Ok(())
            }
        }
    }

    /// Ungated header fetch for the download page. Returns None if missing/expired.
    pub async fn get_header(&self, id: &str, now: DateTime<Utc>) -> anyhow::Result<Option<Vec<u8>>> {
        let row: Option<(Vec<u8>,)> = match self {
            Db::Sqlite(p) => sqlx::query_as(
                "SELECT header FROM uploads WHERE id = ?1 AND has_blob = 1 \
                 AND (expires_at IS NULL OR expires_at > ?2)")
                .bind(id).bind(now).fetch_optional(p).await?,
            Db::Postgres(p) => sqlx::query_as(
                "SELECT header FROM uploads WHERE id = $1 AND has_blob = TRUE \
                 AND (expires_at IS NULL OR expires_at > $2)")
                .bind(id).bind(now).fetch_optional(p).await?,
        };
        Ok(row.map(|(h,)| h))
    }

    /// Public meta fetch for GET /dl/{id}/meta. Returns None if missing/expired/no blob.
    pub async fn public_meta(&self, id: &str, now: DateTime<Utc>) -> anyhow::Result<Option<PublicMetaRow>> {
        match self {
            Db::Sqlite(p) => {
                let row = sqlx::query(
                    "SELECT header, size_cipher, max_downloads, download_count, expires_at, unlock_at \
                     FROM uploads WHERE id = ?1 AND has_blob = 1 \
                     AND (expires_at IS NULL OR expires_at > ?2)")
                    .bind(id).bind(now).fetch_optional(p).await?;
                Ok(row.map(|r| PublicMetaRow {
                    header: r.get::<Vec<u8>, _>(0),
                    size_cipher: r.get::<i64, _>(1),
                    max_downloads: r.get::<Option<i64>, _>(2),
                    download_count: r.get::<i64, _>(3),
                    expires_at: r.get::<Option<DateTime<Utc>>, _>(4),
                    unlock_at: r.get::<Option<DateTime<Utc>>, _>(5),
                }))
            }
            Db::Postgres(p) => {
                let row = sqlx::query(
                    "SELECT header, size_cipher, max_downloads, download_count, expires_at, unlock_at \
                     FROM uploads WHERE id = $1 AND has_blob = TRUE \
                     AND (expires_at IS NULL OR expires_at > $2)")
                    .bind(id).bind(now).fetch_optional(p).await?;
                Ok(row.map(|r| PublicMetaRow {
                    header: r.get::<Vec<u8>, _>(0),
                    size_cipher: r.get::<i64, _>(1),
                    max_downloads: r.get::<Option<i64>, _>(2),
                    download_count: r.get::<i64, _>(3),
                    expires_at: r.get::<Option<DateTime<Utc>>, _>(4),
                    unlock_at: r.get::<Option<DateTime<Utc>>, _>(5),
                }))
            }
        }
    }

    /// Cheap pre-check: return unlock_at for a valid (has_blob, not expired) row.
    /// Returns None if row is missing/expired OR unlock_at is NULL (already unlocked).
    pub async fn unlock_at(&self, id: &str) -> anyhow::Result<Option<DateTime<Utc>>> {
        match self {
            Db::Sqlite(p) => {
                let row: Option<(Option<DateTime<Utc>>,)> = sqlx::query_as(
                    "SELECT unlock_at FROM uploads WHERE id = ?1 AND has_blob = 1")
                    .bind(id).fetch_optional(p).await?;
                Ok(row.and_then(|(u,)| u))
            }
            Db::Postgres(p) => {
                let row: Option<(Option<DateTime<Utc>>,)> = sqlx::query_as(
                    "SELECT unlock_at FROM uploads WHERE id = $1 AND has_blob = TRUE")
                    .bind(id).fetch_optional(p).await?;
                Ok(row.and_then(|(u,)| u))
            }
        }
    }

    /// Mark blob written + persist size (called after PUT blob streams successfully).
    pub async fn mark_blob_written(&self, id: &str, size_cipher: i64) -> anyhow::Result<()> {
        match self {
            Db::Sqlite(p) => { sqlx::query(
                "UPDATE uploads SET has_blob = 1, size_cipher = ?2, upload_token_hash = NULL WHERE id = ?1")
                .bind(id).bind(size_cipher).execute(p).await?; }
            Db::Postgres(p) => { sqlx::query(
                "UPDATE uploads SET has_blob = TRUE, size_cipher = $2, upload_token_hash = NULL WHERE id = $1")
                .bind(id).bind(size_cipher).execute(p).await?; }
        }
        Ok(())
    }

    /// Atomic claim-or-resume. Returns the storage info to stream, or Gone.
    pub async fn claim_or_resume(
        &self,
        id: &str,
        session_id: &str,
        now: DateTime<Utc>,
    ) -> anyhow::Result<ClaimOutcome> {
        match self {
            Db::Sqlite(p) => claim_sqlite(p, id, session_id, now).await,
            Db::Postgres(p) => claim_postgres(p, id, session_id, now).await,
        }
    }

    pub async fn status(&self, id: &str, owner_token_hash: &str) -> anyhow::Result<Option<StatusRow>> {
        let row: Option<(i64, Option<i64>, Option<DateTime<Utc>>, Option<DateTime<Utc>>, i64, DateTime<Utc>)> = match self {
            Db::Sqlite(p) => sqlx::query_as(
                "SELECT download_count, max_downloads, expires_at, unlock_at, size_cipher, created_at \
                 FROM uploads WHERE id = ?1 AND owner_token_hash = ?2")
                .bind(id).bind(owner_token_hash).fetch_optional(p).await?,
            Db::Postgres(p) => sqlx::query_as(
                "SELECT download_count, max_downloads, expires_at, unlock_at, size_cipher, created_at \
                 FROM uploads WHERE id = $1 AND owner_token_hash = $2")
                .bind(id).bind(owner_token_hash).fetch_optional(p).await?,
        };
        Ok(row.map(|(download_count, max_downloads, expires_at, unlock_at, size_cipher, created_at)| StatusRow {
            download_count, max_downloads, expires_at, unlock_at, size_cipher, created_at,
        }))
    }

    /// Owner-authenticated delete. Returns the storage_key to delete from blob store, or None.
    pub async fn delete_by_owner(&self, id: &str, owner_token_hash: &str) -> anyhow::Result<Option<String>> {
        let row: Option<(String,)> = match self {
            Db::Sqlite(p) => sqlx::query_as(
                "DELETE FROM uploads WHERE id = ?1 AND owner_token_hash = ?2 RETURNING storage_key")
                .bind(id).bind(owner_token_hash).fetch_optional(p).await?,
            Db::Postgres(p) => sqlx::query_as(
                "DELETE FROM uploads WHERE id = $1 AND owner_token_hash = $2 RETURNING storage_key")
                .bind(id).bind(owner_token_hash).fetch_optional(p).await?,
        };
        Ok(row.map(|(k,)| k))
    }

    /// Owner-authenticated lookup of the download-auth hash + upload-token hash (for handler auth).
    pub async fn auth_row(&self, id: &str) -> anyhow::Result<Option<(String, String, Option<String>, Option<DateTime<Utc>>)>> {
        // (owner_token_hash, download_auth_hash, upload_token_hash, upload_token_expires_at)
        let row = match self {
            Db::Sqlite(p) => sqlx::query_as(
                "SELECT owner_token_hash, download_auth_hash, upload_token_hash, upload_token_expires_at \
                 FROM uploads WHERE id = ?1").bind(id).fetch_optional(p).await?,
            Db::Postgres(p) => sqlx::query_as(
                "SELECT owner_token_hash, download_auth_hash, upload_token_hash, upload_token_expires_at \
                 FROM uploads WHERE id = $1").bind(id).fetch_optional(p).await?,
        };
        Ok(row)
    }

    /// Worker: rows to GC = expired OR (exhausted AND last claim older than resume grace).
    pub async fn query_doomed(&self, now: DateTime<Utc>, resume_cutoff: DateTime<Utc>)
        -> anyhow::Result<Vec<(String, String)>>
    {
        let rows: Vec<(String, String)> = match self {
            Db::Sqlite(p) => sqlx::query_as(
                "SELECT id, storage_key FROM uploads WHERE \
                 (expires_at IS NOT NULL AND expires_at <= ?1) OR \
                 (max_downloads IS NOT NULL AND download_count >= max_downloads \
                  AND (last_claim_at IS NULL OR last_claim_at <= ?2))")
                .bind(now).bind(resume_cutoff).fetch_all(p).await?,
            Db::Postgres(p) => sqlx::query_as(
                "SELECT id, storage_key FROM uploads WHERE \
                 (expires_at IS NOT NULL AND expires_at <= $1) OR \
                 (max_downloads IS NOT NULL AND download_count >= max_downloads \
                  AND (last_claim_at IS NULL OR last_claim_at <= $2))")
                .bind(now).bind(resume_cutoff).fetch_all(p).await?,
        };
        Ok(rows)
    }

    pub async fn delete_row(&self, id: &str) -> anyhow::Result<()> {
        match self {
            Db::Sqlite(p) => { sqlx::query("DELETE FROM uploads WHERE id = ?1").bind(id).execute(p).await?; }
            Db::Postgres(p) => { sqlx::query("DELETE FROM uploads WHERE id = $1").bind(id).execute(p).await?; }
        }
        Ok(())
    }
}

// ---- claim helpers (per backend) ----

async fn claim_sqlite(p: &sqlx::Pool<sqlx::Sqlite>, id: &str, session: &str, now: DateTime<Utc>)
    -> anyhow::Result<ClaimOutcome>
{
    let mut tx = p.begin().await?;
    // Resume? If this (id, session) already claimed, stream again without incrementing.
    // Also enforce unlock_at: a locked file cannot be resumed either.
    let existing: Option<(String, i64)> = sqlx::query_as(
        "SELECT storage_key, size_cipher FROM uploads WHERE id = ?1 AND has_blob = 1 \
         AND (expires_at IS NULL OR expires_at > ?2) \
         AND (unlock_at IS NULL OR unlock_at <= ?2) \
         AND id IN (SELECT upload_id FROM download_claims WHERE upload_id = ?1 AND session_id = ?3)")
        .bind(id).bind(now).bind(session).fetch_optional(&mut *tx).await?;
    if let Some((storage_key, size_cipher)) = existing {
        sqlx::query("UPDATE uploads SET last_claim_at = ?2 WHERE id = ?1").bind(id).bind(now)
            .execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(ClaimOutcome::Streamed(ClaimOk { storage_key, size_cipher }));
    }
    // New claim: conditional increment (also gated by unlock_at).
    let claimed: Option<(String, i64)> = sqlx::query_as(
        "UPDATE uploads SET download_count = download_count + 1, last_claim_at = ?2 \
         WHERE id = ?1 AND has_blob = 1 \
         AND (max_downloads IS NULL OR download_count < max_downloads) \
         AND (expires_at IS NULL OR expires_at > ?2) \
         AND (unlock_at IS NULL OR unlock_at <= ?2) \
         RETURNING storage_key, size_cipher")
        .bind(id).bind(now).fetch_optional(&mut *tx).await?;
    match claimed {
        Some((storage_key, size_cipher)) => {
            sqlx::query("INSERT INTO download_claims (upload_id, session_id, claimed_at) VALUES (?1,?2,?3)")
                .bind(id).bind(session).bind(now).execute(&mut *tx).await?;
            tx.commit().await?;
            Ok(ClaimOutcome::Streamed(ClaimOk { storage_key, size_cipher }))
        }
        None => { tx.rollback().await?; Ok(ClaimOutcome::Gone) }
    }
}

async fn claim_postgres(p: &sqlx::Pool<sqlx::Postgres>, id: &str, session: &str, now: DateTime<Utc>)
    -> anyhow::Result<ClaimOutcome>
{
    let mut tx = p.begin().await?;
    // Resume — also enforce unlock_at: a locked file cannot be resumed.
    let existing: Option<(String, i64)> = sqlx::query_as(
        "SELECT storage_key, size_cipher FROM uploads WHERE id = $1 AND has_blob = TRUE \
         AND (expires_at IS NULL OR expires_at > $2) \
         AND (unlock_at IS NULL OR unlock_at <= $2) \
         AND EXISTS (SELECT 1 FROM download_claims WHERE upload_id = $1 AND session_id = $3)")
        .bind(id).bind(now).bind(session).fetch_optional(&mut *tx).await?;
    if let Some((storage_key, size_cipher)) = existing {
        sqlx::query("UPDATE uploads SET last_claim_at = $2 WHERE id = $1").bind(id).bind(now)
            .execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(ClaimOutcome::Streamed(ClaimOk { storage_key, size_cipher }));
    }
    // New claim: conditional increment (also gated by unlock_at).
    let claimed: Option<(String, i64)> = sqlx::query_as(
        "UPDATE uploads SET download_count = download_count + 1, last_claim_at = $2 \
         WHERE id = $1 AND has_blob = TRUE \
         AND (max_downloads IS NULL OR download_count < max_downloads) \
         AND (expires_at IS NULL OR expires_at > $2) \
         AND (unlock_at IS NULL OR unlock_at <= $2) \
         RETURNING storage_key, size_cipher")
        .bind(id).bind(now).fetch_optional(&mut *tx).await?;
    match claimed {
        Some((storage_key, size_cipher)) => {
            sqlx::query("INSERT INTO download_claims (upload_id, session_id, claimed_at) VALUES ($1,$2,$3)")
                .bind(id).bind(session).bind(now).execute(&mut *tx).await?;
            tx.commit().await?;
            Ok(ClaimOutcome::Streamed(ClaimOk { storage_key, size_cipher }))
        }
        None => { tx.rollback().await?; Ok(ClaimOutcome::Gone) }
    }
}
