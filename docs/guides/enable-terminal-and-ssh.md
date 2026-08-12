# How to enable the terminal and SSH tools

Both tools ship disabled and are inert without an explicit allowlist — a
skill with no allowlist registers nothing. That shape is intentional; keep
it (see [Design decisions](../explanation/design-decisions.md)).

## Terminal

In `config/elliott.yaml`:

```yaml
tools:
  terminal:
    enabled: true
    root: .elliott-runtime/workspace
    allowed_commands: [ls, cat, rg]   # must be non-empty
```

- `root` confines execution to the workspace directory.
- An empty `allowed_commands` list means the tool does not register, even
  with `enabled: true`.

## SSH

```yaml
tools:
  ssh:
    enabled: true
    user: elliott
    hosts: [web-01]                   # must be non-empty
```

plus a private key the secret reference resolves to:

```yaml
# config/secrets.yaml
ssh_private_key: ${ENV:ELLIOTT_SSH_PRIVATE_KEY}
# or, from HashiCorp Vault KV:
# ssh_private_key: ${VAULT:secret/data/example#ssh_private_key}
```

All three conditions are required — `enabled`, a non-empty `hosts` list,
and a resolvable `ssh_private_key`. Absent any one of them, the tool stays
unregistered and the rest of the runtime boots normally.

## Verify

Restart the runtime and confirm the tools appear in the registered tool
set. Every call still passes the per-skill guard (command / host
allowlist) *and* the governance layer — governance is defense in depth
above the skill guards, not a replacement for them.
