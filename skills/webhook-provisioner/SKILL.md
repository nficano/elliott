---
name: webhook-provisioner
description: Provision verified public webhook endpoints for consumer skills.
---

# webhook-provisioner

Provides the `ingress.webhook@1` facility: zero-config provisioning of a
verified public webhook endpoint. A consumer skill acquires a grant during its
own `register()` and receives the public URL to hand to the sender plus the
internal runtime route it must serve; the provisioner owns everything in
between. Design: `docs/explanation/skill-facilities.md`.

## Contract

```ts
const grant = await context.facilities.acquire("ingress.webhook", "my-hook", {
  verification: { profile: "slack-v2", secretRef: "slack.signingSecret" },
});
// grant.values.url          → https://<hooks host>/w/<slug>  (register with sender)
// grant.values.internalPath → /v1/ingress/<slug>             (serve a RouteBinding here)
// grant.values.secret       → minted profiles only (hmac-sha256, token-query)
```

Verification profiles:

- `hmac-sha256` — facility mints the secret; sender signs the raw body into
  `x-elliott-signature` (hex HMAC-SHA256).
- `token-query` — facility mints the token; sender appends `?token=<secret>`.
- `slack-v2` — Slack request signing (`v0=` HMAC over `v0:{ts}:{body}`,
  5-minute tolerance). `secretRef` names the runtime settings path holding the
  Slack signing secret; the raw value never flows through the acquire call.

## Phase 1 shape

Verification runs in-process: each endpoint mounts `POST /w/<slug>` on the
runtime server behind the operator-configured hooks hostname (the existing
cloudflared tunnel). Payloads are size-capped and verified there, then
forwarded to `internalPath` over the loopback with the internal
`x-elliott-signature` hop (`webhook_signing_secret`), so consumer routes never
trust an unverified delivery even from localhost. Unverifiable payloads are
dropped and counted (`/healthz` → `webhook-provisioner`).

Grants are idempotent per (consumer, name): the slug — and with it the public
URL registered with the sender — survives reboots and re-acquires. Endpoint
records persist under `.elliott-runtime/webhook-provisioner/endpoints.json`.

Dormant until `gateways.webhook_provisioner` (hooks base URL) and
`webhook_signing_secret` are configured. Cloudflare API provisioning and the
isolated ingress-proxy companion are phases 2–3.
