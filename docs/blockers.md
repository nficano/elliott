# Non-blocking catalog gaps

Elliott's production runtime on Spruce is operational. Every bundled component
in `skills/` now ships an executable module (declared via `exports` in its
`manifest.yaml`) and registers directly with the runtime. Nothing in the TDD
§7.16 catalog is descriptor-only anymore. The remaining items are provisioning
and activation decisions, not missing code:

- `web-parallel`: implemented, but `secret/services/oslo` has no
  `parallel_api_key`, so the tool stays unregistered until one is added.
- `gateway-email`: implemented (SMTP-over-TLS outbound with a recipient
  allowlist), but `channels.email.enabled` is false and no `smtp_password`
  or allowlist is configured. Inbound IMAP is not implemented; Gmail inbound
  is served by `gateway-gmail`.
- `gateway-webhook`: implemented (HMAC-verified inbound route), but
  `secret/services/oslo` has no `webhook_signing_secret`; the route stays
  unregistered until one is provisioned.
- `gateway-bluebubbles`: the outbound adapter is bundled and the password
  exists, but `channels.bluebubbles.enabled` stays false until a LAN server
  endpoint and recipient allowlist are verified. Inbound iMessage is not
  implemented.
- `gateway-home-assistant`: implemented (REST state/entities/service tools),
  but `channels.home_assistant.enabled` is false by default because Home
  Assistant is also reachable through the `home-assistant` MCP endpoint in
  `agents/elliott.yaml`; enable one path or the other.
- `terminal` and `ssh`: implemented, but disabled by default and inert
  without an explicit allowlist. `terminal` needs `tools.terminal.enabled`
  plus a non-empty `allowed_commands`; `ssh` needs `tools.ssh.enabled`, a
  non-empty `hosts` list, and an `ssh_private_key` in Vault. Absent those,
  they register nothing, preserving Elliott's stated security model.
- `cloudflared`: the tunnel health checker is implemented but dormant until
  `gateways.cloudflared.ready_url` points at a local cloudflared `/ready`
  metrics endpoint. The control/health API remains bound to Spruce loopback
  while Slack uses Socket Mode.
- `gateway-slack`: the complete Agent messaging experience is implemented and
  its importable manifest lives at
  `skills/gateway/slack/slack-app-manifest.yaml`. The Slack app must be updated
  from that manifest and reinstalled before the new events/scopes become live.
  An optional user OAuth token is still a provisioning choice; without it,
  real-time search remains action-token-authorized and public-channel-only.

`files` is enabled by default, contained to `.elliott-runtime/workspace` with
symlink-escape checks on every read and write. The production Compose stack
mounts `.elliott-runtime` on the persistent `elliott-runtime` volume so files
and reminder state survive container replacement.

A secret listed in `config/secrets.yaml` whose Vault field is missing is
omitted at boot rather than fatal: the skills that need it stay unregistered
while the rest of the runtime starts.

GlitchTip ingestion is live and verified against project ID 2. The Vault field
`sentry_auth_token` is not accepted by the GlitchTip management API, so automated
API-side issue reads need a separate GlitchTip API token; this does not affect
event ingestion.
