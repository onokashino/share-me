use share_me_api::{
    config::Config,
    db::Db,
    routes::{build_router, init_tracing, AppState},
    storage::BlobStore,
    worker,
};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tower_governor::{governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cfg = Config::load_or_exit();
    init_tracing();
    let db = Db::connect(&cfg.database_url).await?;
    db.migrate().await?;
    let blob = BlobStore::from_config(&cfg)?;

    let token = CancellationToken::new();
    let tracker = TaskTracker::new();

    tracker.spawn(worker::expiry_worker(
        db.clone(),
        blob.clone(),
        cfg.resume_ttl_secs,
        Duration::from_secs(cfg.expiry_sweep_secs),
        token.clone(),
    ));

    // Build the per-IP rate limiter.  GovernorLayer requires ConnectInfo
    // extensions that only exist on a real TCP socket (via
    // into_make_service_with_connect_info), so we apply it here in main.rs
    // rather than inside build_router — that way the oneshot Router tests
    // remain unaffected.
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(cfg.rate_limit_per_sec as u64)
            .burst_size(cfg.rate_limit_burst)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .unwrap(),
    );

    // Spawn a background cleanup task that calls retain_recent() every 60 s
    // so stale rate-limit entries don't accumulate unboundedly.
    let governor_limiter = governor_conf.limiter().clone();
    {
        let cleanup_token = token.clone();
        tracker.spawn(async move {
            let interval = Duration::from_secs(60);
            loop {
                tokio::select! {
                    _ = cleanup_token.cancelled() => break,
                    _ = tokio::time::sleep(interval) => {
                        tracing::debug!(
                            size = governor_limiter.len(),
                            "rate-limit storage retain_recent"
                        );
                        governor_limiter.retain_recent();
                    }
                }
            }
        });
    }

    let app = build_router(AppState {
        db,
        blob,
        cfg: cfg.clone(),
    })
    .layer(GovernorLayer::new(governor_conf));

    let listener = tokio::net::TcpListener::bind(&cfg.bind_addr).await?;
    tracing::info!(addr = %cfg.bind_addr, "listening");
    {
        let token = token.clone();
        tracker.spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move { token.cancelled().await })
            .await
            .expect("server error");
        });
    }

    shutdown_signal().await;
    token.cancel();
    tracker.close();
    tracker.wait().await;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("ctrl_c");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}
