pub mod download;
pub mod health;
pub mod uploads;

use crate::{config::Config, db::Db, storage::BlobStore};
use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, post, put},
    Router,
};
use axum::http::header::{AUTHORIZATION, COOKIE};
use axum::http::StatusCode;
use std::time::Duration;
use tower::ServiceBuilder;
use tower_http::{
    sensitive_headers::{
        SetSensitiveRequestHeadersLayer, SetSensitiveResponseHeadersLayer,
    },
    timeout::TimeoutLayer,
    trace::TraceLayer,
};

/// Total-request timeout for the small JSON / metadata routes. The streaming
/// blob upload/download routes are intentionally excluded — a large transfer can
/// legitimately run far longer; those are bounded by the fronting proxy's
/// read/write/idle timeouts (and a standalone deployment should set them too).
const REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub blob: BlobStore,
    pub cfg: Config,
}

pub fn build_router(state: AppState) -> Router {
    let max = state.cfg.max_file_size;

    // Build the blob PUT route in its own sub-Router so we can call
    // Router::layer() (which has no NewError generic ambiguity) to disable
    // axum's default 2MB body limit and optionally apply an operator cap.
    // When max_file_size == 0, we just disable axum's 2MB default with no
    // additional cap.  Both paths stay streaming — no whole-body buffering.
    // Blob PUT in its own sub-Router: disable axum's 2 MB default body limit and
    // optionally apply the operator cap. Stays streaming — no whole-body buffer.
    let blob_put: Router<AppState> = if max > 0 {
        Router::new()
            .route("/api/v1/uploads/{id}/blob", put(uploads::put_blob))
            .layer(tower_http::limit::RequestBodyLimitLayer::new(max as usize))
            .layer(DefaultBodyLimit::disable())
    } else {
        Router::new()
            .route("/api/v1/uploads/{id}/blob", put(uploads::put_blob))
            .layer(DefaultBodyLimit::disable())
    };

    // Streaming routes: blob upload + download. These must NOT get a total-request
    // TimeoutLayer (a large transfer can take a long time legitimately); the GET
    // blob route is added here, after the PUT's body-limit layer, so the limit
    // does not apply to it.
    let stream_router: Router<AppState> =
        blob_put.route("/api/v1/dl/{id}/blob", get(download::blob));

    // Small JSON / metadata routes get a tight total-request timeout so a slow
    // client cannot pin a connection on them (slowloris / slow-read).
    let json_router: Router<AppState> = Router::new()
        .route("/healthz", get(health::healthz))
        .route("/api/v1/uploads", post(uploads::create))
        .route("/api/v1/uploads/{id}/status", get(uploads::status))
        .route("/api/v1/uploads/{id}", delete(uploads::delete))
        .route("/api/v1/dl/{id}", get(download::header))
        .route("/api/v1/dl/{id}/meta", get(download::meta))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(REQUEST_TIMEOUT_SECS),
        ));

    // Middleware stack: trace first so spans wrap everything, then sensitive-
    // header redaction so tokens never appear in logs.
    // NOTE: GovernorLayer (rate limiting) is applied in main.rs after
    // into_make_service_with_connect_info, because it requires ConnectInfo
    // extensions that are only available from a real TCP socket — not from
    // oneshot Router tests that bypass the connection layer.
    let middleware = ServiceBuilder::new()
        .layer(TraceLayer::new_for_http())
        .layer(SetSensitiveRequestHeadersLayer::new([AUTHORIZATION, COOKIE]))
        .layer(SetSensitiveResponseHeadersLayer::new([AUTHORIZATION, COOKIE]));

    json_router
        .merge(stream_router)
        .with_state(state)
        .layer(middleware)
}

pub fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};
    let _ = tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(fmt::layer())
        .try_init();
}
