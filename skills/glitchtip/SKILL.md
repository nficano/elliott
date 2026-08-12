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

Payloads carry only the error's type, message, mechanism, timestamp, and the
configured environment/release. The DSN, tokens, and Vault paths never enter an
envelope body — the reporter hands the sink a normalized `CapturedError`, never
settings.
