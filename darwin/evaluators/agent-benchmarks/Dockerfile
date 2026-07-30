FROM oven/bun:1.3.8-slim@sha256:68fc2eac7f5dcfc2f69a81d1db02786ab08772eda2e4404eae785c038f8d2e41

WORKDIR /opt/elliott

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

COPY src ./src
COPY darwin/runtime/http.ts \
     darwin/runtime/smoke.ts \
     darwin/runtime/wire.ts \
     ./darwin/runtime/
COPY darwin/evaluators/agent-benchmarks/benchmark \
     ./darwin/evaluators/agent-benchmarks/benchmark
COPY darwin/evaluators/agent-benchmarks/candidate \
     ./darwin/evaluators/agent-benchmarks/candidate
COPY darwin/evaluators/agent-benchmarks/evaluation \
     ./darwin/evaluators/agent-benchmarks/evaluation
COPY darwin/evaluators/agent-benchmarks/server.ts \
     ./darwin/evaluators/agent-benchmarks/server.ts

RUN chown -R bun:bun /opt/elliott

ENV ELLIOTT_BENCHMARK_DRIVER_CONFIG="/opt/elliott/darwin/evaluators/agent-benchmarks/benchmark/drivers.json"
USER bun
EXPOSE 9073
ENTRYPOINT ["bun", "/opt/elliott/darwin/evaluators/agent-benchmarks/server.ts"]
CMD ["--port", "9073", "--maximum-jobs", "1"]
