# syntax=docker/dockerfile:1

# ---- build stage ----
FROM rust:1-slim-bookworm AS builder
WORKDIR /app

# Copy the whole workspace: ballistics-api depends on ballistics-core, and
# cargo needs the workspace Cargo.toml/Cargo.lock present to resolve it.
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

RUN cargo build --release -p ballistics-api

# ---- runtime stage ----
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/ballistics-api ./ballistics-api
COPY crates/ballistics-api/static ./static

ENV BALLISTICS_STATIC_DIR=/app/static
EXPOSE 3000

CMD ["./ballistics-api"]
