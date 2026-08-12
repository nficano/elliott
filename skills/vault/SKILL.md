---
name: vault
description: Inspect allowlisted HashiCorp Vault KV v2 paths for provisioning — metadata only, never secret values. Off unless explicitly enabled.
---

# Vault

Off by default. It registers only when `tools.vault.enabled` is true and a
non-empty address, a non-empty token (`secret://tools/vault/token`), and at
least one non-empty allowlist path are all present — like the ssh tool, it fails
closed: no allowlist, no skill. Empty or whitespace-only values are treated as
absent, not accepted.

`vault_kv_describe` inspects one allowlisted KV v2 path (`GET <address>/v1/<path>`)
and returns **metadata only** — the field names present (`{path, fields}`), or,
with an optional `field`, whether that field is provisioned (`{path, field,
present}`). It **never returns a secret value.** This upholds the opaque-secret
invariant: tool output is placed into model context, and secrets must never
reach the model. Secret *values* are resolved at the config boundary via
`${VAULT:path#field}` expressions and injected into the skills that need them —
never fetched by the agent at runtime.

The allowlist entries are full KV v2 API paths (e.g. `secret/data/myapp`); a path
not on the list is refused without echoing what was asked for. The token is an
opaque reference resolved at the config boundary — never logged and never
returned. Every failure (denied path, HTTP error, transport error) throws a
generic message that discloses no token, host, or path, so nothing sensitive can
leave through a captured error payload.
