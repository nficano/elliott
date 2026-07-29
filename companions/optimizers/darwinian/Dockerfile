FROM alpine/git:2.49.1@sha256:c0280cf9572316299b08544065d3bf35db65043d5e3963982ec50647d2746e26 AS darwinian-source
ARG DARWINIAN_REVISION=7f12365d2059c47e29068a5a6f498a293148d2a9
RUN git clone --filter=blob:none https://github.com/imbue-ai/darwinian_evolver.git /source \
    && git -C /source checkout --detach "${DARWINIAN_REVISION}" \
    && test "$(git -C /source rev-parse HEAD)" = "${DARWINIAN_REVISION}"

FROM oven/bun:1.3.8-slim@sha256:68fc2eac7f5dcfc2f69a81d1db02786ab08772eda2e4404eae785c038f8d2e41 AS elliott-dependencies
WORKDIR /opt/elliott-dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM ghcr.io/astral-sh/uv:0.8.24@sha256:1d31be550ff927957472b2a491dc3de1ea9b5c2d319a9cea5b6a48021e2990a6 AS uv
FROM python:3.12.11-slim@sha256:47ae396f09c1303b8653019811a8498470603d7ffefc29cb07c88f1f8cb3d19f

COPY --from=uv /uv /usr/local/bin/uv
COPY --from=darwinian-source /source /usr/share/darwinian-evolver/source
RUN uv sync \
      --project /usr/share/darwinian-evolver/source \
      --frozen \
      --no-dev \
      --no-cache

COPY --from=elliott-dependencies /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /opt/elliott
COPY --from=elliott-dependencies /opt/elliott-dependencies/node_modules ./node_modules
COPY src ./src
COPY companions/runtime/http.ts \
     companions/runtime/smoke.ts \
     companions/runtime/wire.ts \
     ./companions/runtime/
COPY companions/optimizers/contract.ts \
     companions/optimizers/server.ts \
     ./companions/optimizers/
COPY companions/optimizers/jobs/controller.ts \
     companions/optimizers/jobs/support.ts \
     ./companions/optimizers/jobs/
COPY companions/optimizers/python/worker.py \
     ./companions/optimizers/python/worker.py
COPY companions/optimizers/darwinian/problem.py \
     companions/optimizers/darwinian/worker.py \
     ./companions/optimizers/darwinian/

RUN useradd --system --uid 65532 --home /nonexistent --shell /usr/sbin/nologin elliott \
    && chown -R elliott:elliott /opt/elliott

ENV PATH="/usr/share/darwinian-evolver/source/.venv/bin:/usr/local/bin:/usr/bin:/bin" \
    PYTHONPATH="/opt/elliott" \
    PYTHONUNBUFFERED="1"
USER 65532:65532
EXPOSE 9072
ENTRYPOINT ["bun", "/opt/elliott/companions/optimizers/server.ts"]
CMD ["--worker-kind", "code", "--worker-command-json", "[\"python\",\"/opt/elliott/companions/optimizers/darwinian/worker.py\"]", "--port", "9072"]
