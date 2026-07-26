FROM python:3.12.11-slim@sha256:47ae396f09c1303b8653019811a8498470603d7ffefc29cb07c88f1f8cb3d19f

WORKDIR /opt/elliott
COPY deploy/placement/model-proxy/model_proxy.py ./

RUN useradd --system --uid 65532 --home /nonexistent --shell /usr/sbin/nologin elliott \
    && chown -R elliott:elliott /opt/elliott

ENV PYTHONUNBUFFERED="1"
USER 65532:65532
ENTRYPOINT ["python", "/opt/elliott/model_proxy.py"]
