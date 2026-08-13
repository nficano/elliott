---
name: glitchtip
description: Ship runtime errors to a Sentry-compatible collector (GlitchTip or Sentry), on by default with zero setup.
---

# GlitchTip

Error visibility that works with no user wiring. On by default: the runtime's
neutral error reporter always logs to the console, and this skill attaches a
sink that ships each captured failure to a Sentry-compatible collector as an
envelope. With no operator DSN the sink targets the bundled collector companion
(`deploy/compose.glitchtip.yml`); set `observability.glitchtip.dsn` to point at
your own Sentry or GlitchTip instead, or `observability.glitchtip.enabled:
false` to stay console-only — in which case nothing here loads.

The sink is bounded and best-effort: at most 100 events are held (drop-oldest
past the cap), delivery is fire-and-forget, and every network failure is
swallowed. Killing the collector mid-run turns sends into no-ops; errors queue
and then drop, and neither the sink nor the agent loop crashes.

Payloads carry only structural, secret-safe fields: the error class, its stack
frames (the `at …` lines — never the `Error: <message>` header), the mechanism,
and the timestamp. Nothing sourced from config, the secrets file, Vault, or the
process environment crosses the wire — not even the deployment `environment` or
`release`, since those come from env variables that could coincide with a
resolved secret value; they stay in the local boot log only. The error
**message is never transmitted** either — it is the one field a caller can
interpolate a secret into, so it stays in the local console and never crosses the
process boundary. The reporter hands the sink a message-free `TransmittableError`,
never a message and never settings, so no secret can ride out and no redaction is
needed. The DSN rides only on the POST target and auth header.
