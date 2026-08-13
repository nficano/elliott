# How to enable the terminal and SSH tools

Both ship disabled, and both stay unregistered without an explicit allowlist.
Flipping `enabled` alone does nothing.

## Terminal

In `config/elliott.yaml`:

```yaml
tools:
  terminal:
    enabled: true
    root: .elliott-runtime/workspace
    allowed_commands: [ls, cat, rg]
```

`root` confines execution to that directory. `allowed_commands` must be
non-empty; with `[]` the tool does not register even when `enabled: true`.

## SSH

```yaml
tools:
  ssh:
    enabled: true
    user: elliott
    hosts: [web-01]
```

Plus a key in `config/secrets.yaml`:

```yaml
ssh_private_key: ${ENV:ELLIOTT_SSH_PRIVATE_KEY}
# or from Vault:
# ssh_private_key: ${VAULT:secret/data/example#ssh_private_key}
```

All three conditions are required: the flag, a non-empty `hosts` list, and a
resolvable `ssh_private_key`. Miss any one and the tool stays unregistered while
the rest of the runtime boots.

## Verify

Restart and check the tool count:

```bash
curl -s localhost:8080/healthz
```

If the count did not move, the boot log names what was missing.

## What happens on each call

`ssh_exec` runs through the kernel's capability broker with a grant scoped to
exactly the hosts you listed, so a host outside `hosts` is denied before the
skill's own guard ever sees it, and the denial lands in the audit trail. The
terminal tool checks its command allowlist inside the skill and is wrapped by
the same governance chokepoint every tool passes through.

Both layers stay in place. Governance sits above the per-skill guards rather
than replacing them.

## If you need to shut one off without a restart

Use the [governance kill switch](operate-the-governance-kill-switch.md).
