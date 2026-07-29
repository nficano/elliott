FROM oven/bun:1.3.8-slim@sha256:68fc2eac7f5dcfc2f69a81d1db02786ab08772eda2e4404eae785c038f8d2e41

WORKDIR /opt/elliott

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

COPY src ./src
COPY companions/typescript/wire.ts \
     companions/typescript/server.ts \
     companions/typescript/smoke.ts \
     ./companions/typescript/
COPY companions/benchmarks/benchmark.ts \
     companions/benchmarks/benchmark-config.ts \
     companions/benchmarks/benchmark-driver.ts \
     companions/benchmarks/benchmark-result.ts \
     companions/benchmarks/code-check.ts \
     companions/benchmarks/evaluation.ts \
     companions/benchmarks/evaluation-baseline.ts \
     companions/benchmarks/evaluation-benchmarks.ts \
     companions/benchmarks/evaluation-compare.ts \
     companions/benchmarks/evaluation-executor.ts \
     companions/benchmarks/evaluation-metrics.ts \
     companions/benchmarks/evaluation-validation.ts \
     companions/benchmarks/server.ts \
     companions/benchmarks/snapshot-executor-driver.ts \
     companions/benchmarks/benchmark-drivers.json \
     ./companions/benchmarks/

RUN chown -R bun:bun /opt/elliott

ENV ELLIOTT_BENCHMARK_DRIVER_CONFIG="/opt/elliott/companions/benchmarks/benchmark-drivers.json"
USER bun
EXPOSE 9073
ENTRYPOINT ["bun", "/opt/elliott/companions/benchmarks/server.ts"]
CMD ["--port", "9073", "--maximum-jobs", "1"]
