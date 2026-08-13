# Facilities

A facility is infrastructure one skill provides to another. It is the fifth
binding kind on the `register()` seam, and it exists to solve two problems that
turned out to be the same problem.

## The problems

Skills had no way to consume infrastructure another skill could provide. Any
skill wanting a public HTTPS endpoint, for Slack interactivity, Stripe events,
GitHub webhooks, or Pub/Sub push, would have to reimplement tunnel wiring, DNS,
signature verification, and secret handling on its own. In practice that meant
those integrations did not get built.

Separately, a skill had no runtime mechanism to declare what it offers so others
could discover it and configure themselves against it. The canonical layer
already had the shape for this in `ComponentManifest.protocols`,
`ComponentRegistry`, and `ComponentDiscovery`, but the skill loader fed none of
it. `SkillRegistration` knew only tools, gateways, routes, and services.

Facilities are one seam answering both.

## How it works

A skill provides a facility. A consumer acquires a grant from it during its own
`register()`. The provider hands back whatever it provisioned.

The interaction is deliberately MCP-shaped. `list`, `describe`, and `acquire`
mirror `tools/list` and `tools/call`, so the same records can back
ComponentDiscovery cards and MCP exposure later without inventing a second
registration path.

## Two planes, kept apart

The **control plane** is provisioning-time negotiation. A consumer asks for "a
Slack-verified endpoint named `slack-interactivity`" and receives a stable public
URL, an internal path, and a secret. Grants persist and are idempotent, so the
URL a consumer registered with Slack survives a reboot.

The **data plane** is ordinary route traffic. The consumer returns a normal
`RouteBinding` at the grant's internal path, and verified payloads arrive there
like any other request. The facility never touches message content after
provisioning.

Keeping these apart is what makes the seam reusable. A facility that also
carried payloads would be a proxy with a config API, and every new integration
would need its own.

## The webhook path

```
sender (Slack/Stripe/GitHub)
  → Cloudflare edge (DNS CNAME · TLS · optional Worker filter)
  → cloudflared tunnel (outbound-only)
  → ingress proxy companion (per-endpoint verification, size and rate caps)
  → runtime POST <internalPath> (internal HMAC hop, x-elliott-signature)
  → consumer skill's RouteBinding
```

No inbound port opens on the runtime host. The only ingress is the tunnel the
`cloudflared` companion already establishes outbound.

## What ships

Three facilities exist today. `ingress.webhook@1` comes from the
`webhook-provisioner` skill, with in-process verification profiles for
`hmac-sha256`, `token-query`, and `slack-v2`. `dns.local@1` comes from `pihole`
and `proxy.route@1` from `traefik`, both installed from the registry.

Two consumers use them. `gateway-slack` acquires an interactivity endpoint;
`deep-trace` chains `proxy.route` into `dns.local` to publish its observability
map at a LAN hostname.

The second and third facilities existed to answer an open question from the
original design: whether the seam was webhook-shaped or general. DNS records and
proxy routes are neither webhooks nor each other, and both fit without changing
the seam, so the answer was general.

## Load order

Packages declaring `spec.provides` register first, in a two-pass load. That is
the whole reason the loader has two passes: a consumer needs its grant during
`register()`, so the provider has to have registered already.

If the provider is not installed, `acquire` throws, the consumer's `register()`
fails, and the runtime boots without it. That is the ordinary degrade path, and
it means a facility consumer needs a smoke test like any other skill.

## Identity is stamped, not claimed

`FacilityRequest.consumer` comes from the acquiring package's `metadata.name`,
set by the loader. A skill cannot present another skill's identity to a
provider, which matters because grants are keyed on it.

The grant store keys on consumer, facility, and name together, so one consumer
can hold handles across several facilities without collision.

## Releasing

`release(grantId)` tears down what was provisioned. The runtime never calls it
implicitly. A facility grant that vanished because a skill failed to load would
take a DNS record or a public route with it, and rebooting into a broken
integration is worse than rebooting into a degraded one.

Exact shapes: [SkillContext reference](../reference/api/skill-context.md).
Practical steps: [Consume a facility](../guides/consume-a-facility.md).
