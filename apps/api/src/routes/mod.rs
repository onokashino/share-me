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
use tower::ServiceBuilder;
use tower_http::{
    sensitive_headers::{
        SetSensitiveRequestHeadersLayer, SetSensitiveResponseHeadersLayer,
    },
    trace::TraceLayer,
};

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
    let blob_router: Router<AppState> = if max > 0 {
        Router::new()
            .route("/api/v1/uploads/{id}/blob", put(uploads::put_blob))
            .layer(tower_http::limit::RequestBodyLimitLayer::new(max as usize))
            .layer(DefaultBodyLimit::disable())
    } else {
        Router::new()
            .route("/api/v1/uploads/{id}/blob", put(uploads::put_blob))
            .layer(DefaultBodyLimit::disable())
    };

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

    Router::new()
        .route("/healthz", get(health::healthz))
        .route("/api/v1/uploads", post(uploads::create))
        .route("/api/v1/uploads/{id}/status", get(uploads::status))
        .route("/api/v1/uploads/{id}", delete(uploads::delete))
        .route("/api/v1/dl/{id}", get(download::header))
        .route("/api/v1/dl/{id}/meta", get(download::meta))
        .route("/api/v1/dl/{id}/blob", get(download::blob))
        .merge(blob_router)
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
