---
name: cloudflared
description: Provision and maintain the Cloudflare tunnel that carries inbound webhooks, and watch that it stays up.
---

# cloudflared

A containerized elliott has no public IP. Inbound webhooks reach it through a
Cloudflare tunnel: Cloudflare terminates `https://hooks.example.com`, the tunnel
carries the request to the runtime's HTTP port, and
[webhook-provisioner](../webhook-provisioner/SKILL.md) verifies it and dispatches
it to whichever skill acquired the `ingress.webhook` grant.

Give this skill Cloudflare credentials and it builds that path itself.

## What it provisions

On every boot, idempotently:

1. **A named tunnel** — `elliott-<hostname>`, adopted if it already exists.
   Deleted tunnels are excluded from the lookup, because adopting one yields an
   id that can never connect.
2. **Ingress rules** — the hostname routed to `http://localhost:<runtime port>`,
   with a catch-all 404. This is the rule that keeps a provisioned tunnel from
   becoming general-purpose ingress into the host: whatever hostname is routed,
   it terminates at this runtime's own port.
3. **A proxied CNAME** — `hooks.example.com → <tunnel-id>.cfargotunnel.com`.
   Proxied is not optional; unproxied would expose the tunnel target directly.

A boot on an already-provisioned account performs three GETs and changes
nothing. It reports only what it actually changed, so a restart is silent and
the one boot that took action stands out.

It also heals drift. A DNS record left pointing at a deleted tunnel, or ingress
pointing at the wrong port, is rewritten — both are failures that look fine
until someone sends a webhook.

## What it does not do

**It never runs the connector.** `cloudflared` runs in its own locked-down
container, supervised by compose. elliott is not given a Docker socket: a socket
is root-equivalent on the host and would dwarf every other capability in this
framework.

**It does not choose your hostname.** You do, in config. An ephemeral
quick-tunnel name would change on every restart and silently invalidate every
URL already registered with Slack and every other sender.

## Configuration

```yaml
gateways:
  cloudflared:
    api_token: ${VAULT:infra/cloudflare#api_token}
    account_id: "…"
    zone_id: "…"
    hostname: hooks.example.com
    # Optional: the sidecar's metrics endpoint. Supply it and the tunnel's
    # health is watched too, not just provisioned.
    ready_url: http://cloudflared:20241/ready
  webhook_provisioner:
    enabled: true
    hooks_base_url: https://hooks.example.com
```

The API token needs `Zone:DNS:Edit` on the zone and
`Account:Cloudflare Tunnel:Edit` on the account. **Scope it to the one zone.**
It is the highest-blast-radius credential this runtime holds — it can create and
delete DNS records — so it is a secret-bearing field and must be an opaque
reference, never a literal.

The four provisioning fields are supplied together or not at all. Three of four
registers nothing rather than silently degrading to watch-only, which would look
like success while no hostname was ever routed.

## Connector token handoff

The connector token is fetched from the API on each boot and written to
`<stateDirectory>/cloudflared/connector-token`, owner-read-only, via a temp file
and rename so the sidecar never reads a partial value.

This is the one place a credential this runtime holds is written to disk, and it
is deliberate: a sibling container cannot read another's memory, and the
alternatives are worse — a Docker socket, or making elliott a secret server.

```yaml
# compose
cloudflared:
  image: cloudflare/cloudflared:latest
  command: tunnel --no-autoupdate --metrics 0.0.0.0:20241 run
  environment:
    TUNNEL_TOKEN_FILE: /run/elliott/cloudflared/connector-token
  volumes:
    - elliott-state:/run/elliott:ro
  read_only: true
  cap_drop: [ALL]
  security_opt: [no-new-privileges:true]
  depends_on: [elliott]
```

`depends_on` matters: elliott writes the token during its own boot, so the
connector has nothing to read until it has run once.

## Health

```json
{"cloudflared":{"provisioned":1,"ready":1,"readyConnections":4,"consecutiveFailures":0,"checks":12,"lastCheckMs":1786883298106}}
```

`provisioned: 0` means the tunnel and DNS could not be established — the
hostname routes nowhere. `ready: 0` means they exist but the connector is not
carrying traffic. `readyConnections: 0` with a 200 from the metrics endpoint is
a process that is alive and routing nothing, which for inbound webhooks is the
same as down and is not treated as ready.
