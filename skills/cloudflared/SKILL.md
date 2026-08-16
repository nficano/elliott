---
name: cloudflared
description: Watch the cloudflared tunnel that carries inbound webhooks, so a dead tunnel is visible instead of silent.
---

# cloudflared

A containerized elliott has no public IP. Inbound webhooks reach it through a
cloudflared tunnel: Cloudflare terminates `https://hooks.example.com`, the
tunnel carries the request to the runtime's HTTP port, and
[webhook-provisioner](../webhook-provisioner/SKILL.md) verifies and dispatches
it to whichever skill acquired the `ingress.webhook` grant.

That tunnel is load-bearing and, until this skill, invisible. `webhook-provisioner`
mints `<hooksBaseUrl>/w/<slug>` and `gateway-slack` registers it with Slack, but
nothing checked the hostname resolves to anything. With the tunnel down, every
delivery is dropped at Cloudflare's edge: Slack shows a delivery failure, the
runtime shows a healthy process and an empty log, and the two are never
connected.

This skill closes that gap. It does not run the tunnel.

## What it does

Polls cloudflared's metrics `/ready` endpoint every 30 seconds and:

- reports `ready: 0` in `/healthz` while the tunnel cannot carry traffic,
- reports through the error sink on the transition to down, once per incident
  rather than once per poll,
- counts `readyConnections` — the established connections to Cloudflare's edge.
  A process that is alive with zero connections is routing nothing, which for
  inbound webhooks is the same as down, so it is not treated as ready.

## What it deliberately does not do

**It never starts, stops, or supervises cloudflared.** The tunnel runs as its
own container, supervised by compose. Exec'ing a binary that opens public
ingress is a capability this framework does not take: the whole placement model
rests on a skill's egress being declarable and its blast radius bounded, and a
managed tunnel process is neither.

It also does not discover the hostname. `hooksBaseUrl` stays operator
configuration, because Slack and every other sender need a URL that survives a
restart — an ephemeral quick-tunnel hostname would silently invalidate every
registered endpoint.

## Configuration

```yaml
gateways:
  cloudflared:
    ready_url: http://cloudflared:20241/ready
```

Absent the key the skill registers nothing, like every other gate here. The URL
is the sidecar's metrics endpoint on the container network — start cloudflared
with `--metrics 0.0.0.0:20241`.

Pair it with the hostname the tunnel terminates:

```yaml
gateways:
  webhook_provisioner:
    hooks_base_url: https://hooks.example.com
```

## Health

```json
{"cloudflared":{"ready":1,"readyConnections":4,"consecutiveFailures":0,"checks":12,"lastCheckMs":1786883298106}}
```

`ready: 0` with a nonzero `consecutiveFailures` is the signal that public
webhook delivery is broken, regardless of what the rest of `/healthz` says.
