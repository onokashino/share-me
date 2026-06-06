use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("not found")]
    NotFound,
    #[error("gone")]
    Gone, // 410: expired or download limit reached
    #[error("locked")]
    Locked, // 423: file not yet unlocked (timed release)
    #[error("payload too large")]
    TooLarge,
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Storage(#[from] object_store::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self {
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Gone => StatusCode::GONE,
            AppError::Locked => StatusCode::LOCKED,
            AppError::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Db(_) | AppError::Storage(_) | AppError::Io(_) | AppError::Other(_) => {
                tracing::error!(error = %self, "internal error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        // Bodies are deliberately terse: never leak internals to clients.
        (status, status.canonical_reason().unwrap_or("error")).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    #[test]
    fn status_mapping() {
        assert_eq!(AppError::Unauthorized.into_response().status(), StatusCode::UNAUTHORIZED);
        assert_eq!(AppError::NotFound.into_response().status(), StatusCode::NOT_FOUND);
        assert_eq!(AppError::Gone.into_response().status(), StatusCode::GONE);
        assert_eq!(AppError::TooLarge.into_response().status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            AppError::BadRequest("x".into()).into_response().status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(AppError::Locked.into_response().status(), StatusCode::LOCKED);
    }
}
