# How to operate the governance kill switch

Every model-issued tool call passes through `ToolGovernor`. The control plane
lets you disable one tool or freeze all of them without a restart.

## Open the control plane

The route exists only when the token is set:

```bash
export ELLIOTT_GOVERNANCE_TOKEN="…"
```

With it unset, `/v1/control/governance` does not resolve at all. Authentication
is a bearer token compared in constant time.

## Read current state

```bash
curl -H "authorization: Bearer $ELLIOTT_GOVERNANCE_TOKEN" \
  https://<runtime>/v1/control/governance
```

## Disable one tool

```bash
curl -X POST \
  -H "authorization: Bearer $ELLIOTT_GOVERNANCE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"op":"disable","tool":"ssh_run"}' \
  https://<runtime>/v1/control/governance
```

The model gets an ordinary error message back from the tool and learns it cannot
take that action. The process keeps serving.

## Freeze everything

```bash
curl -X POST \
  -H "authorization: Bearer $ELLIOTT_GOVERNANCE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"op":"freeze"}' \
  https://<runtime>/v1/control/governance
```

Send `{"op":"unfreeze"}` to restore. Use this for incidents, not for routine
configuration.

## Deny a tool permanently

Runtime toggles do not survive a restart. For a standing denial, put it in
`config/elliott.yaml`:

```yaml
governance:
  deny: [ssh_run, terminal_exec]
```

## Who did what

Every toggle is itself written to the audit trail, so `governance.tool-disabled`
and `governance.frozen` are attributable to the principal that set them. Tool
calls carry `argumentsDigest` and `resultDigest`, never raw arguments or output.

The trail is at `.elliott-runtime/audit/records.jsonl` by default.

## What this does not do

Governance is default-allow on the live path. Its value is the trail, the
attribution, explicit denials, and this switch. It is not an allowlist over
every tool.

Per-skill guards stay in place underneath, so a denied SSH host is still
rejected inside the skill even when policy allows the tool. For true
default-deny on a specific high-risk tool, `ssh_exec` already routes through the
kernel's capability broker. See [Governance](../explanation/governance.md).
