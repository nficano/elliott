---
name: vault
description: Read secrets from allowlisted HashiCorp Vault KV v2 paths. Off unless explicitly enabled.
---

# Vault

Off by default. It registers only when `tools.vault.enabled` is true and an
address, a token (`secret://tools/vault/token`), and a non-empty path allowlist
are all present — like the ssh tool, it fails closed: no allowlist, no skill.

`vault_kv_read` reads one allowlisted KV v2 path (`GET <address>/v1/<path>`) and
returns the secret's keys, or a single `field`. The allowlist entries are full
KV v2 API paths (e.g. `secret/data/myapp`); a path not on the list is refused
without echoing what was asked for.

The token is an opaque reference resolved at the config boundary — never logged
and never returned. Every failure (denied path, HTTP error, transport error,
missing field) throws a generic message that discloses no token, host, or path,
so nothing sensitive can leave through a captured error payload. Returned secret
values are untrusted output; treat them as such.
