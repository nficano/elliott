FROM python:3.12.11-slim@sha256:47ae396f09c1303b8653019811a8498470603d7ffefc29cb07c88f1f8cb3d19f

WORKDIR /opt/elliott
COPY companions/common/elliott_companion ./elliott_companion
COPY companions/benchmarks/benchmark_worker.py \
     companions/benchmarks/benchmark_server.py \
     companions/benchmarks/code_check_worker.py \
     companions/benchmarks/evaluation_worker.py \
     companions/benchmarks/snapshot_executor_driver.py \
     companions/benchmarks/benchmark-drivers.json \
     ./

RUN useradd --system --uid 65532 --home /nonexistent --shell /usr/sbin/nologin elliott \
    && chown -R elliott:elliott /opt/elliott

ENV ELLIOTT_BENCHMARK_DRIVER_CONFIG="/opt/elliott/benchmark-drivers.json" \
    PYTHONPATH="/opt/elliott" \
    PYTHONUNBUFFERED="1"
USER 65532:65532
EXPOSE 9073
ENTRYPOINT ["python", "/opt/elliott/benchmark_server.py"]
CMD ["--port", "9073", "--maximum-jobs", "1"]
