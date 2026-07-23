FROM oven/bun:1.3.8-alpine AS runtime

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --ignore-scripts

COPY --chown=bun:bun . .
RUN mkdir -p /app/.elliott-runtime && chown -R bun:bun /app/.elliott-runtime /app/agents

USER bun
EXPOSE 8080
CMD ["bun", "src/runtime/main.ts"]
