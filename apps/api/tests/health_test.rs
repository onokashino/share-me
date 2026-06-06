use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
mod common;

#[tokio::test]
async fn healthz_ok() {
    let app = common::test_router().await;
    let res = app
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}
