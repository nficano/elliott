FROM oven/bun:1.3.8-slim@sha256:68fc2eac7f5dcfc2f69a81d1db02786ab08772eda2e4404eae785c038f8d2e41

WORKDIR /opt/elliott

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

COPY src ./src
COPY companions/runtime/http.ts \
     companions/runtime/smoke.ts \
     companions/runtime/wire.ts \
     ./companions/runtime/
COPY companions/evaluators/agent-benchmarks/benchmark \
     ./companions/evaluators/agent-benchmarks/benchmark
COPY companions/evaluators/agent-benchmarks/candidate \
     ./companions/evaluators/agent-benchmarks/candidate
COPY companions/evaluators/agent-benchmarks/evaluation \
     ./companions/evaluators/agent-benchmarks/evaluation
COPY companions/evaluators/agent-benchmarks/server.ts \
     ./companions/evaluators/agent-benchmarks/server.ts

RUN chown -R bun:bun /opt/elliott

ENV ELLIOTT_BENCHMARK_DRIVER_CONFIG="/opt/elliott/companions/evaluators/agent-benchmarks/benchmark/drivers.json"
USER bun
EXPOSE 9073
ENTRYPOINT ["bun", "/opt/elliott/companions/evaluators/agent-benchmarks/server.ts"]
CMD ["--port", "9073", "--maximum-jobs", "1"]
