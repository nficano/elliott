# Skill facilities: cross-skill provisioning and secure webhook ingress

Status: phase 1 landed · 2026-07-29 (proposed 2026-07-28)

> **What landed (phase 1):** the facility seam (`FacilityBinding`/
> `FacilityDirectory` in `src/runtime/skills/types.ts`, two-pass loader,
> grant store in `src/runtime/skills/facilities.ts`, `spec.provides`
> decoding) plus three facilities: `ingress.webhook@1`
> (`skills/webhook-provisioner`, in-process verification with the
> `hmac-sha256`/`token-query`/`slack-v2` profiles), and — answering the
> "is the seam webhook-shaped?" open question — `dns.local@1`
> (`skills/pihole`) and `proxy.route@1` (`skills/traefik`). Consumers:
> `gateway-slack` acquires a Slack interactivity endpoint;
> `skills/telemetry-map` chains `proxy.route` → `dns.local` to publish the
> observability map at a LAN hostname. Two deltas from the text below:
> `FacilityDirectory` also exposes consumer-scoped `release(grantId)`, and
> the grant store keys on (consumer, facility, name) so one consumer can
> reuse a handle across facilities. Tests:
> `test/unit/{facilities,webhook-profiles}.test.ts`,
> `test/integration/skills/{webhook-facility,local-publish}-smoke.test.ts`.

## Intent

Two problems, one seam.

First, skills have no way to consume infrastructure that another skill can
provide. Today every skill that needs a public HTTPS endpoint (Slack Block Kit
interactivity, Stripe events, GitHub webhooks, Google Pub/Sub push) would have
to reimplement tunnel wiring, DNS, signature verification, and secret handling
itself — or, realistically, we just don't build those integrations.

Second, there is no runtime mechanism for a skill to *declare* what it offers
so other skills can discover and auto-configure against it. The design model
already has this shape — `ComponentManifest.protocols`, `ComponentRegistry`,
`ComponentDiscovery.search/inspect/prepareCall` in `src/core/registry/` — but
none of it is fed by the skill loader; `SkillRegistration`
(`src/runtime/skills/types.ts`) knows only `tools | gateways | routes |
services`.

This TDD introduces **facilities**: a fifth binding kind on the register()
seam. A skill *provides* a facility; a consumer skill *acquires* a grant from
it during its own `register()`. The interaction is deliberately MCP-shaped —
`list` / `describe` / `acquire` mirror `tools/list` / `tools/call` — so the
same records can later back `ComponentDiscovery` cards and MCP exposure
without a second registration path.

The first facility is `ingress.webhook`: zero-config provisioning of a
verified, Cloudflare-fronted webhook endpoint, terminating in an isolated
proxy rather than a public listener on the runtime host. A consumer asks for
"a Slack-verified endpoint named `slack-interactivity`" and gets back a stable
public URL plus an internal delivery path — nothing else to configure.

This is framework infrastructure and lives in elliott (`skills/`,
`src/runtime/`), not in an agent repo. Agent repos opt in via
`spec.components` in `agent.yaml` as usual.

## Design overview

Two planes, kept strictly separate:

- **Control plane (facilities)** — provisioning-time negotiation. The
  webhook-provisioner skill registers the `ingress.webhook` facility; a
  consumer acquires a grant and receives `{ url, internalPath, secret }`.
  Grants are persisted and idempotent, so the public URL a consumer registered
  with Slack survives reboots.
- **Data plane (existing seams)** — payload delivery. The consumer returns an
  ordinary `RouteBinding` at the grant's `internalPath`. Verified webhook
  payloads arrive there exactly like any other route traffic. The facility
  never touches message content after provisioning.

```
sender (Slack/Stripe/GitHub)
  → Cloudflare edge (DNS CNAME · TLS · optional Worker filter)
  → cloudflared tunnel (existing companion, outbound-only)
  → ingress proxy companion (isolated: per-endpoint verification, size/rate caps)
  → runtime POST <internalPath> (internal HMAC hop, x-elliott-signature)
  → consumer skill's RouteBinding
```

No inbound port is ever opened on the runtime host; the only ingress is the
tunnel the `cloudflared` companion already establishes outbound
(`skills/cloudflared/EXTENSION.md`).

## The facility seam

### Types (`src/runtime/skills/types.ts`)

`SkillRegistration` gains one optional field; nothing else on the seam
changes:

```ts
// src/runtime/skills/types.ts — additions
export interface FacilityBinding {
  readonly id: string;                 // "ingress.webhook"
  readonly version: number;            // integer; breaking contract changes bump it
  describe(): FacilityDescriptor;      // MCP-like card
  acquire(request: FacilityRequest): Promise<FacilityGrant>;
  release?(grantId: string): Promise<void>;
}

export interface FacilityDescriptor {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly requestSchema: JsonRecord;  // JSON Schema for FacilityRequest.config
  readonly grantSchema: JsonRecord;    // JSON Schema for FacilityGrant.values
}

export interface FacilityRequest {
  readonly consumer: string;           // stamped by the loader, never caller-supplied
  readonly name: string;               // consumer-chosen handle, e.g. "slack-interactivity"
  readonly config: JsonRecord;         // validated against requestSchema
}

export interface FacilityGrant {
  readonly grantId: string;
  readonly facility: string;           // "ingress.webhook@1"
  readonly values: JsonRecord;         // validated against grantSchema
}

export interface FacilityDirectory {
  list(): readonly FacilityDescriptor[];
  describe(id: string): FacilityDescriptor | undefined;
  acquire(id: string, name: string, config: JsonRecord): Promise<FacilityGrant>;
}

export interface SkillRegistration {
  readonly tools?: readonly ToolDefinition[];
  readonly gateways?: readonly GatewayBinding[];
  readonly routes?: readonly RouteBinding[];
  readonly services?: readonly ServiceBinding[];
  readonly facilities?: readonly FacilityBinding[];   // new
}
```

`SkillContext` gains `facilities: FacilityDirectory`. The loader stamps
`consumer` with the acquiring package's `metadata.name` so a grant is always
attributable — a skill cannot impersonate another consumer.

### Boot ordering (`src/runtime/app.ts`, `src/runtime/skills/loader.ts`)

Providers must register before consumers acquire. Ordering comes from the
manifest, not from runtime introspection: a package that provides facilities
declares them under `spec.provides` (see Manifest changes below).
`loadSkillRegistrations` becomes two-pass:

1. Register every package whose manifest declares `spec.provides`; collect
   their `FacilityBinding`s into the directory. A facility provider may not
   itself acquire (cycles rejected at load, fail-fast like the duplicate-tool
   check in `src/runtime/skills/loader.ts`).
2. Register everything else with the populated directory on `SkillContext`.
   Consumers call `context.facilities.acquire(...)` inside `register()` and
   fold the grant into the bindings they return — e.g. a `RouteBinding` at
   `grant.values.internalPath`.

A consumer that acquires a facility no package provides gets a hard error
naming the missing facility id — same dormant-vs-broken philosophy as secrets:
a *dormant provider* (unset settings → provider registered `{}`) makes the
consumer's acquire fail loudly rather than silently misconfigure.

### Grant persistence

Grants must be stable: the URL a consumer registered with Slack cannot change
on reboot. `acquire` is idempotent on `(consumer, name)` — a repeat call
returns the stored grant. Grants live in a JSON store under
`context.stateDirectory` (`<agentRoot>/.elliott-runtime/facilities/grants.json`),
written atomically. Secrets inside grant values are stored there too, which is
acceptable for phase 1 (the state dir is already trusted — it holds runtime
state) and moves behind the secret broker in phase 3.

`release(grantId)` tears down provisioned resources (DNS record, tunnel route,
stored secret) and is the only destructive operation; it is never called
implicitly.

### Discovery alignment

`FacilityDescriptor` is deliberately isomorphic to a `ComponentCard`
(`src/core/registry/types.ts`) plus a `ProtocolDescriptor` schema pair. Phase
4 feeds registered facilities into the kernel's `ComponentRegistry` so
`ComponentDiscovery.search/inspect` and `GET /v1/components` report them —
one registration, two views. Until then the runtime directory is the sole
authority, which matches how `docs/elliott-tdd.md` §7.5/§7.11 machinery is being
adopted incrementally elsewhere.

## The `ingress.webhook` facility

Provided by a new framework skill, `skills/webhook-provisioner/` (kind:
`extension`, profile: `extension-standard`). Request/grant contract:

```ts
// acquire("ingress.webhook", "slack-interactivity", config)
interface WebhookRequestConfig {
  verification:
    | { profile: "hmac-sha256" }                       // facility mints the secret
    | { profile: "token-query" }                       // facility mints the token
    | { profile: "slack-v2"; secretRef: string }       // sender-defined secret, by settings ref
    | { profile: "github"; secretRef: string }
    | { profile: "stripe"; secretRef: string };
  maxBodyBytes?: number;    // default 65536, matching gateway-webhook's MAX_BODY_BYTES
  expiresAt?: string;       // ISO date; omit for standing endpoints
}

interface WebhookGrantValues {
  url: string;              // public: https://hooks.<zone>/w/<slug>
  internalPath: string;     // runtime route the consumer must serve: /v1/ingress/<slug>
  secret?: string;          // only for facility-minted profiles (hmac-sha256, token-query)
}
```

Design points:

- **Slugs, not guessable paths.** `<slug>` is 128 bits from
  `crypto.randomBytes`, base64url. The slug alone is *not* the security
  boundary — verification is — but it prevents drive-by discovery and lets us
  revoke per-endpoint without touching DNS.
- **Verification profiles, not a verification flag.** Each profile is a small
  pure function `(request, body, material) → boolean` living in the
  provisioner. `slack-v2` implements Slack's `v0=` HMAC over
  `v0:{timestamp}:{body}` with the 5-minute timestamp tolerance (this is what
  unblocks Block Kit interactivity); `github` checks
  `x-hub-signature-256`; `stripe` checks `Stripe-Signature` `t=`/`v1=` with
  tolerance; `hmac-sha256` is the generic profile matching
  `skills/gateway/webhook`'s `x-elliott-signature` scheme; `token-query`
  reuses `verifiedRequestToken` from `src/runtime/skills/http.ts`. All
  comparisons go through `constantTimeEqual`.
- **Secrets flow in the right direction.** For facility-minted profiles the
  grant returns the secret and the consumer hands it to the sender. For
  sender-defined profiles (Slack signing secret) the consumer passes a
  *reference* — a settings/secret key resolved by the provisioner via
  `context.settings` — never the raw value through the acquire call, so grant
  storage never duplicates Vault-held material.
- **Delivery contract.** After verification the payload is forwarded to
  `internalPath` with the internal HMAC hop (below). The consumer's
  `RouteBinding` receives the raw sender body plus
  `x-elliott-ingress-{slug,profile,timestamp}` headers. Unverifiable payloads
  are dropped before broker ingress and counted, matching the posture in
  `skills/gateway/webhook/GATEWAY.md` ("drop unverifiable payloads").

## Cloudflare provisioning

The provisioner owns a scoped Cloudflare client, built in the
`src/providers/google/` style: `src/providers/cloudflare/{types,client,index}.ts`
— small credentials interface, injectable `fetcher`, bounded retry on
429/5xx. No SDK dependency.

- **Hostname strategy: one stable first-level hostname per agent**, e.g.
  `oslo-hooks.<zone>`, path-routed by slug. First-level keeps Cloudflare
  Universal SSL sufficient (deeper levels like `oslo.hooks.<zone>` require
  Advanced Certificate Manager). One CNAME per agent means DNS writes happen
  once at provisioner first-boot, not per-endpoint — smaller blast radius,
  no cert churn, and endpoint revocation never touches DNS. Per-endpoint
  hostnames are a possible later extension, not the default.
- **Remotely-managed tunnel.** The existing `cloudflared` companion connects
  outbound with a token; the provisioner manages its *configuration* via the
  Cloudflare API (`cfd_tunnel/{id}/configurations`), adding the public
  hostname → ingress-proxy service mapping. The companion itself is never
  reconfigured or restarted.
- **API token scoping (hard requirement).** One dedicated token, stored in
  Vault (`config/secrets.yaml`: `cloudflare_api_token:
  ${VAULT:secret/services/oslo#cloudflare_api_token}`), scoped to exactly:
  Zone → DNS → Edit on the hooks zone only; Account → Cloudflare Tunnel →
  Edit. Nothing account-wide, no Workers scope until phase 4. The token is
  resolved into `RuntimeSettings` like every other secret
  (`src/runtime/config.ts` interpolation) and the skill stays dormant
  (`register()` returns `{}` minus the facility) when unset — but note the
  fail-loud consumer behavior above.
- **Optional edge Worker (phase 4).** A Worker on the hooks hostname can
  reject unverifiable traffic at the edge — provider-signature checks,
  body-size cap, per-slug rate limits — so garbage never crosses the tunnel.
  It is an optimization and hardening layer, not a trust boundary we rely on:
  the proxy re-verifies everything (never trust the edge's verdict; treat the
  Worker as a bouncer, not a notary).

## The isolated ingress proxy

A dedicated companion container, declared in the provisioner's manifest the
same way `skills/cloudflared/manifest.yaml` declares its companion:

```yaml
# skills/webhook-provisioner/manifest.yaml (excerpt)
spec:
  companions:
    - name: ingress-proxy
      image: elliott/ingress-proxy@sha256:operator-pinned
      egress: { class: declared, hosts: [elliott-runtime] }
      endpoint: webhook-only
```

Properties:

- **Blast-radius containment.** The proxy parses hostile input (signature
  headers, arbitrary bodies) so the runtime doesn't. It has no Vault access,
  no tunnel token, and network reachability only to (a) the cloudflared
  companion's internal network and (b) the runtime's HTTP port. A proxy
  compromise yields per-endpoint verification material and nothing else.
- **Verification material delivery.** The runtime pushes endpoint records
  `{ slug, profile, material, maxBodyBytes, expiresAt }` to the proxy over a
  mutually-authenticated local admin endpoint at grant/release time (proxy
  holds a boot-minted shared secret; runtime is the only client). This is the
  `mountInto` pattern from `src/security/secrets/` — material is *placed
  into* the isolation boundary, the proxy never fetches it.
- **Internal hop is verified too.** Proxy → runtime forwarding signs the body
  with the existing `webhook_signing_secret` using the
  `x-elliott-signature` HMAC scheme from `skills/gateway/webhook`, so a
  process that can reach the runtime port cannot inject fake "verified"
  webhooks. Two independent verifications: sender's at the proxy, elliott's
  at the runtime.
- **Caps enforced before parsing.** Body size (default 64 KiB), 30s upstream
  timeout, and per-slug token-bucket rate limits are enforced on the raw
  stream before any signature work.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Forged webhook payloads | Per-endpoint verification profile at the proxy; constant-time compares; drop-before-ingress |
| Replay of captured requests | Timestamp tolerance in `slack-v2`/`stripe` profiles; nonce/event-id LRU for `hmac-sha256` where senders supply ids |
| Endpoint URL leakage | URL is not a credential — verification still required; 128-bit slugs prevent enumeration; per-slug revocation |
| Runtime compromise via hostile payload parsing | Parsing isolated in the proxy companion; runtime sees only internally-signed, size-capped bodies |
| Cloudflare token theft | Token scoped to one zone's DNS + tunnel config; cannot read secrets, deploy Workers (until phase 4), or touch other zones |
| Skill impersonating another consumer | `FacilityRequest.consumer` stamped by the loader from the package manifest, not caller input |
| Proxy → runtime injection | Internal HMAC hop with `webhook_signing_secret`; runtime rejects unsigned internal deliveries |
| SSRF via forwarding config | Proxy forwards to a fixed runtime address baked at companion start; grant config carries no URLs. Outbound provisioner calls use `publicUrl()` from `src/runtime/skills/http.ts` |
| Stale endpoints accumulating | `expiresAt` on grants; proxy refuses expired slugs; `release()` tears down end-to-end |

## Manifest changes

Providers declare facilities; consumers request them with the existing
capability grammar (`capability` + resource URIs, matching `secret://…`):

```yaml
# skills/webhook-provisioner/manifest.yaml — provider side
spec:
  provides:
    - { facility: ingress.webhook, version: 1 }
  capabilities:
    - { capability: secret.use, resources: [secret://facilities/cloudflare] }
    - { capability: network.connect, resources: [cloudflare-api] }

# a consumer (e.g. gateway-slack) — consumer side
spec:
  capabilities:
    - { capability: facility.use, resources: ["facility://core/ingress.webhook@1"] }
```

`src/catalog/bundled.ts` learns to decode `spec.provides` (it already ignores
unknown spec fields, so old manifests are unaffected); `BundledPackage` gains
`provides: readonly FacilityRef[]`. `facility.use` is advisory until
agent-skills phase 4 makes `spec.components`/capabilities the activation
authority — the doc's "Rules going forward" apply here unchanged.

## Rollout

## Phase 1 — facility seam + in-process webhook facility (build first)

- `FacilityBinding`/`FacilityDirectory` types, two-pass loader, grant store
  under `stateDirectory`, `spec.provides` decoding in `src/catalog/bundled.ts`.
- `skills/webhook-provisioner` with the `ingress.webhook` facility, but
  verification runs **in-process** as runtime `RouteBinding`s behind the
  existing operator-run cloudflared companion with a statically configured
  hooks hostname. No Cloudflare API writes, no new companion yet.
- Profiles: `hmac-sha256`, `token-query`, `slack-v2`.
- Tier-0 integration tests per `docs/skill-e2e-smoke-strategy.md`: acquire →
  route registered → signed request accepted → tampered request dropped →
  re-acquire returns identical grant.

## Phase 2 — Cloudflare provisioning (planned)

- `src/providers/cloudflare/` client; scoped token in Vault; DNS CNAME +
  remotely-managed tunnel hostname config at provisioner boot.
- `github` and `stripe` profiles; grant `expiresAt` enforcement.

## Phase 3 — isolated proxy companion (planned, needs sign-off)

- `ingress-proxy` companion image; verification moves out of the runtime;
  admin push of endpoint records; internal HMAC hop; grant secrets move
  behind the secret-broker model (`src/security/secrets/`).
- Runtime keeps the phase-1 in-process verifier as a fallback path so the
  proxy is not a boot dependency.

## Phase 4 — edge + discovery convergence (planned)

- Optional Cloudflare Worker edge filter (adds Workers scope to the token
  only at this point).
- Facilities fed into `ComponentRegistry`; visible via `ComponentDiscovery`
  and `GET /v1/components`; optional MCP exposure of `list`/`describe` via
  the existing `McpExposure` path so agents can introspect facilities the
  same way they introspect tools.

## Non-goals

- Generic reverse-proxying or serving non-webhook traffic through the hooks
  hostname.
- Automating the *sender-side* registration (e.g. Slack app manifest API
  pushing the URL to Slack). Grants return the URL; wiring it into the
  sender stays manual or becomes a separate skill.
- Multi-tenant facility federation across agents. One agent, one grant store.

## Open questions

- Grant store backend: `stateDirectory` JSON is phase-1 pragmatic, but the
  runtime already has a Postgres store — should grants live there from the
  start so `release()` and audit share infrastructure?
- Hostname per agent (`oslo-hooks.<zone>`) is the recommendation; confirm the
  zone to delegate and whether tide-pods agents share one zone.
- Should a second facility (`egress.proxy`? `storage.blob`?) be sketched
  before the seam freezes, to check the abstraction isn't webhook-shaped?
- Facility versioning: integer bump per breaking change is proposed; do we
  need side-by-side versions (`acquire("ingress.webhook@1")` vs `@2`) at the
  directory level from day one?
