FROM ghcr.io/astral-sh/uv:0.8.24@sha256:1d31be550ff927957472b2a491dc3de1ea9b5c2d319a9cea5b6a48021e2990a6 AS uv
FROM oven/bun:1.3.8-slim@sha256:68fc2eac7f5dcfc2f69a81d1db02786ab08772eda2e4404eae785c038f8d2e41 AS elliott-dependencies
WORKDIR /opt/elliott-dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM python:3.12.11-slim@sha256:47ae396f09c1303b8653019811a8498470603d7ffefc29cb07c88f1f8cb3d19f

COPY --from=uv /uv /usr/local/bin/uv
COPY --from=elliott-dependencies /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /opt/elliott
COPY --from=elliott-dependencies /opt/elliott-dependencies/node_modules ./node_modules

COPY companions/optimizers/dspy/pyproject.toml \
     companions/optimizers/dspy/uv.lock \
     ./
RUN uv sync --frozen --no-dev --no-cache

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
COPY companions/optimizers/dspy/worker.py \
     ./companions/optimizers/dspy/worker.py

RUN useradd --system --uid 65532 --home /nonexistent --shell /usr/sbin/nologin elliott \
    && chown -R elliott:elliott /opt/elliott

ENV PATH="/opt/elliott/.venv/bin:${PATH}" \
    PYTHONPATH="/opt/elliott" \
    PYTHONUNBUFFERED="1"
USER 65532:65532
EXPOSE 9071
ENTRYPOINT ["bun", "/opt/elliott/companions/optimizers/server.ts"]
CMD ["--worker-kind", "text", "--worker-command-json", "[\"python\",\"/opt/elliott/companions/optimizers/dspy/worker.py\"]", "--port", "9071"]
