# Non-blocking catalog gaps

Elliott's production runtime on Spruce is operational. The following entries in
`src/catalog/index.ts` are architectural descriptors, not executable agent-kit
packages, so they are not exposed to the running agent:

- `search-duckduckgo` and `web-parallel`: no agent-kit registrable exists;
  Parallel also has no credential in `secret/services/oslo`.
- `gateway-email`: Gmail is configured, but no generic IMAP/SMTP credentials or
  adapter are available.
- `cloudflared`: no tunnel token is present, and the current control/health API
  is intentionally bound to Spruce loopback while Slack uses Socket Mode.
- `gateway-bluebubbles`: the outbound adapter and password exist, but no LAN
  server endpoint or recipient has been verified; inbound support is not
  implemented by agent-kit.
- `files`, `terminal`, `ssh`, and `fetch`: these need executable registrables,
  sandbox/allowlist policy, and (for SSH) a scoped key and host allowlist. None
  are present in Vault, so enabling them would bypass Elliott's stated security
  model.

GlitchTip ingestion is live and verified against project ID 2. The Vault field
`sentry_auth_token` is not accepted by the GlitchTip management API, so automated
API-side issue reads need a separate GlitchTip API token; this does not affect
event ingestion.
