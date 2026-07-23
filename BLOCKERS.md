# Non-blocking catalog gaps

Elliott's production runtime on Spruce is operational. Every bundled component
package in `skills/` that has an executable module (declared via `exports` in
its `component.yaml`) registers directly with the runtime. The remaining gaps
are configuration or descriptor-only entries, not missing code:

- `web-parallel`: implemented, but `secret/services/oslo` has no
  `parallel_api_key`, so the tool stays unregistered.
- `gateway-webhook`: implemented (HMAC-verified inbound route), but
  `secret/services/oslo` has no `webhook_signing_secret`; the route stays
  unregistered until one is provisioned.
- `gateway-bluebubbles`: the outbound adapter is bundled and the password
  exists, but `channels.bluebubbles.enabled` stays false until a LAN server
  endpoint and recipient allowlist are verified. Inbound iMessage support is
  not implemented.
- `gateway-email`: Gmail is configured (`gateway-gmail` is live), but no
  generic IMAP/SMTP credentials or adapter are available.
- `cloudflared`: no tunnel token is present, and the current control/health
  API is intentionally bound to Spruce loopback while Slack uses Socket Mode.
- `files`, `terminal`, and `ssh`: these remain architectural descriptors.
  They need sandbox/allowlist policy and (for SSH) a scoped key and host
  allowlist before an executable module would be safe to ship; none are
  present in Vault, so bundling one now would bypass Elliott's stated
  security model.
- `gateway-home-assistant`: descriptor-only; Home Assistant is reached today
  through the `home-assistant` MCP endpoint in `agents/elliott.yaml`.

A secret listed in `config/secrets.yaml` whose Vault field is missing is
omitted at boot rather than fatal: the skills that need it stay unregistered
while the rest of the runtime starts.

GlitchTip ingestion is live and verified against project ID 2. The Vault field
`sentry_auth_token` is not accepted by the GlitchTip management API, so automated
API-side issue reads need a separate GlitchTip API token; this does not affect
event ingestion.
