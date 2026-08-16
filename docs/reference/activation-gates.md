# Activation gates

Every bundled component ships enabled in code and stays dormant until its
configuration is complete. A missing secret, an empty allowlist, or
`enabled: false` leaves a package loaded but unregistered without failing the
boot.

This page lists what each component waits on. It carries no per-deployment
status; that belongs in an operator runbook.

## Reading current state

| Surface | Shows |
| :--- | :--- |
| `GET /healthz` | per-gateway status, per-service health, skill and tool counts, and an `install` section when an `install:` block is configured |
| `GET /v1/observability/map` | every loaded package with runtime state `live` or `config-gated` |
| boot logs | each skill whose `register()` returned no bindings or whose secret was unresolvable |

A required install entry that failed flips `ready` to false. Registration
failures do not.

## Gates

| Component | Dormant until |
| :--- | :--- |
| `terminal` | `tools.terminal.enabled: true` and a non-empty `allowed_commands` |
| `ssh` | `tools.ssh.enabled: true`, a non-empty `hosts` allowlist, and `ssh_private_key` |
| `vault` | `tools.vault.enabled: true`, a non-empty `paths` allowlist, `address`, and a `vault_token` secret |
| `deep-trace` publish | the `proxy.route` and `dns.local` facility providers installed, plus `public_hostname` and `service_url` |
| `gateway-slack` | `channels.slack.enabled: true` plus `app_token`, `bot_token`, `owner_id`, and `default_channel`. Its optional HTTP interactivity route additionally needs `slack_signing_secret` |
| `gateway-email` | `channels.email.enabled: true` plus `smtp_password`, `smtp_host`, `username`, `from`, and a non-empty `allowed_recipients`. Send-only; there is no inbound path |
| `gateway-gmail` | `gmail.enabled: true` plus `gmail_client_id`, `gmail_client_secret`, and `gmail_refresh_token` |
| `gateway-bluebubbles` | `channels.bluebubbles.enabled: true` plus `bluebubbles_password` and `server_url`. Its tools additionally need `allowed_recipients` or a `default_recipient` |
| `gateway-webhook` | its own `webhook_gateway_secret`, deliberately independent of webhook-provisioner's `webhook_signing_secret` so provisioning one never activates the other |
| `search-brave`, `web-firecrawl`, `web-parallel` | the provider's API key secret |
| `search-duckduckgo` | `tools.search_duckduckgo.enabled: true`. No secret, but an operator opts in explicitly |
| `traefik` | `tools.traefik.enabled: true` and `tools.traefik.api_url`. Provides `proxy.route` |
| `webhook-provisioner` | `gateways.webhook_provisioner.enabled: true`, `gateways.webhook_provisioner.hooks_base_url`, and the internal `webhook_signing_secret`. Provides `ingress.webhook` |
| `cloudflared` | either `gateways.cloudflared.ready_url` (watch only) or all four of `api_token`, `account_id`, `zone_id`, `hostname` (provision the tunnel, ingress, and DNS). Three of four registers nothing. Never runs the connector |
| `store` vectors | a reachable Postgres with `pgvector` at `store.dsn` |

Registry-installed components such as `gateway-home-assistant` and `pihole` gate
on their own channel secrets, configured per agent repository.

## Lifting a gate

Supply the secret or set the flag, then restart. The component registers on the
next boot. No code change is involved.
