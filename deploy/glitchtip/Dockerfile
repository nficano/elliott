# syntax=docker/dockerfile:1
# Minimal Sentry-envelope collector — the glitchtip skill's zero-wiring default
# sink. It accepts envelopes on POST /api/<project>/envelope/ and keeps the most
# recent ones in memory for viewing at GET /. Deliberately tiny and stateless: a
# reference sink for out-of-the-box error visibility, NOT a full GlitchTip
# deployment. Point observability.glitchtip.dsn at a real Sentry/GlitchTip when
# you outgrow it.
#
# The collector source is inlined below (not a repo .ts/.js file) so it stays
# outside the framework's typecheck/lint surface; deploy/ is not part of the TS
# project.
FROM oven/bun:1-alpine

WORKDIR /app

RUN <<'EOF' cat > collector.mjs
const PORT = 9080;
const MAX_RECENT = 200;
const recent = [];

const bodyText = async (req) => {
  try {
    return await req.text();
  } catch {
    return "";
  }
};

// A Sentry envelope is newline-delimited JSON: envelope header, item header,
// then the event payload. Store the parsed payload (or the raw line) for view.
const record = (body) => {
  const lines = body.split("\n").filter(Boolean);
  const payload = lines.length >= 3 ? lines[2] : (lines.at(-1) ?? "");
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    event = { raw: payload };
  }
  recent.unshift({ receivedAt: new Date().toISOString(), event });
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
};

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname.endsWith("/envelope/")) {
      record(await bodyText(req));
      return new Response("ok", { status: 200 });
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      return Response.json({ ok: true, stored: recent.length });
    }
    if (req.method === "GET" && url.pathname === "/") {
      return Response.json({ count: recent.length, events: recent });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`glitchtip collector listening on :${PORT}`);
EOF

EXPOSE 9080
CMD ["bun", "collector.mjs"]
