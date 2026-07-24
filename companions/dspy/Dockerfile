FROM ghcr.io/astral-sh/uv:0.8.24@sha256:1d31be550ff927957472b2a491dc3de1ea9b5c2d319a9cea5b6a48021e2990a6 AS uv
FROM python:3.12.11-slim@sha256:47ae396f09c1303b8653019811a8498470603d7ffefc29cb07c88f1f8cb3d19f

COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /opt/elliott

COPY companions/dspy/pyproject.toml companions/dspy/uv.lock ./
RUN uv sync --frozen --no-dev --no-cache

COPY companions/common/elliott_companion ./elliott_companion
COPY companions/dspy/dspy_worker.py ./

RUN useradd --system --uid 65532 --home /nonexistent --shell /usr/sbin/nologin elliott \
    && chown -R elliott:elliott /opt/elliott

ENV PATH="/opt/elliott/.venv/bin:${PATH}" \
    PYTHONPATH="/opt/elliott" \
    PYTHONUNBUFFERED="1"
USER 65532:65532
EXPOSE 9071
ENTRYPOINT ["python", "-m", "elliott_companion.server"]
CMD ["--worker", "dspy_worker:optimize", "--port", "9071"]
