pub mod models;
pub mod queries;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::postgres::PgPoolOptions;
use sqlx::{Pool, Postgres, Sqlite};
use std::str::FromStr;

#[derive(Clone)]
pub enum Db {
    Sqlite(Pool<Sqlite>),
    Postgres(Pool<Postgres>),
}

impl Db {
    pub async fn connect(database_url: &str) -> anyhow::Result<Self> {
        if database_url.starts_with("sqlite:") {
            let opts = SqliteConnectOptions::from_str(database_url)?
                .create_if_missing(true)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
                .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
                .busy_timeout(std::time::Duration::from_secs(5))
                .foreign_keys(true);
            // Single writer connection: serialize writes so SQLITE_BUSY can't lose a claim.
            let pool = SqlitePoolOptions::new().max_connections(1).connect_with(opts).await?;
            Ok(Db::Sqlite(pool))
        } else {
            let pool = PgPoolOptions::new().max_connections(10).connect(database_url).await?;
            Ok(Db::Postgres(pool))
        }
    }

    pub async fn migrate(&self) -> anyhow::Result<()> {
        // Use compile-time embedded migrations via sqlx::migrate! (requires `macros` feature).
        match self {
            Db::Sqlite(p) => sqlx::migrate!("./migrations/sqlite").run(p).await?,
            Db::Postgres(p) => sqlx::migrate!("./migrations/postgres").run(p).await?,
        }
        Ok(())
    }
}
