# syntax=docker/dockerfile:1

# ── builder ──────────────────────────────────────────────────────────────────
# Migrations are compile-time embedded (sqlx::migrate!), so they must be present
# at build time; the runtime image needs only the binary + CA roots.
FROM rust:1-bookworm AS builder
WORKDIR /build
COPY . .
RUN cargo build --release --bin share-me-api

# ── runtime ──────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/target/release/share-me-api /usr/local/bin/share-me-api

# Local-disk backend writes here; mount a volume at /app/data to persist.
# (SQLite + blobs live under ./data relative to this workdir by default.)
ENV STORAGE_LOCAL_PATH=data/blobs \
    DATABASE_URL=sqlite://data/share-me.db

EXPOSE 8080
CMD ["share-me-api"]
