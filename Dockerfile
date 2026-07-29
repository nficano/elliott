FROM rust:1.92-alpine AS hot-core

WORKDIR /build

RUN apk add --no-cache build-base=0.5-r3
COPY native/hot-core ./native/hot-core
RUN RUSTFLAGS="-C target-feature=-crt-static" cargo build \
    --release \
    --locked \
    --manifest-path native/hot-core/Cargo.toml \
    -p elliott-hot-core-napi

FROM oven/bun:1.3.8-alpine AS runtime

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --ignore-scripts

COPY --chown=bun:bun . .
COPY --from=hot-core --chown=bun:bun \
  /build/native/hot-core/target/release/libelliott_hot_core_napi.so \
  /app/native/elliott-hot-core.node
RUN mkdir -p /app/.elliott-runtime && chown -R bun:bun /app/.elliott-runtime /app/agents

USER bun
EXPOSE 8080
CMD ["bun", "src/runtime/main.ts"]
