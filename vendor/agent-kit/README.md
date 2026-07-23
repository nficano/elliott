# agent-kit

Successor to [clawkit](https://github.com/nficano/clawkit) — a from-scratch,
single-container personal-agent framework. **No OpenClaw.**

**Clean-room: zero dependency on `@tmh/*`.** The TeachMeHIPAA `@tmh/ai` /
`@tmh/agents` packages and the `dan-agent` / `seo-agent` services are studied as
prior art; every useful pattern is reimplemented from scratch and owned here.
Feature set to cover comes from oslo/clawkit; adapted for a self-hosted homelab
fleet.

> Status: **M0–M6 implemented** (framework spine → loop → registry/router/memory
> → observability/footprint → jobs/scheduler → trust boundary →
> self-improvement), plus the **capability layer + generic packs**
> ([docs/CAPABILITIES-TDD.md](docs/CAPABILITIES-TDD.md)). Source is in
> [`src/`](src/); design doc in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md);
> the consumer-facing YAML surface is the **agent spec**
> ([docs/AGENT-SPEC.md](docs/AGENT-SPEC.md)). `bun test` green;
> `bunx tsc --noEmit` clean. The three empirical M0 risks (Bun/OTel span
> propagation, pgvectorscale/halfvec, backup restore) still need a live-infra
> spike (§22/§23).

## Layout (`src/`)

```
src/
  core/      llm gateway · agent loop · memory · mcp · di · errors · tokenizer
             chain (call-chain tracing) · edits (anchored edits)
  host/      config · registry (versioned, opt-in) · capabilities (contracts ·
             providers · bus) · router · runtime · scheduler (+rota) · jobs ·
             footprint · observability · model · notify · history · http · bootstrap
  store/     pg pool · migrations runner · DDL · StorePort
  channels/  telegram · chunk/escape adapter contract
  skills/web/ agent-browser client · brave · firecrawl · webpage · sitemap · page-audit
  skills/watch/ snapshots · diff · trend · outcome ledger (over metric-rows@1)
  skills/ops/ spike triage · alert hygiene · self-guard
  skills/email/ gmail inbox triage · follow-up judgment
  skills/github/ draft_pr — reviewable draft PRs (provides change-proposal@1)
  skills/reminders/ durable one-shot "remind me at …" over the job queue
  plugins/   trust (injection screen · approval gate + variants · envelope) ·
             self-improve (observer · reflection)
  integrations/ http core · google-auth · github client (opt-in)
  testkit/   static footprint gate · eval harness
  index.ts   public API (createAgentKit, define, AgentSpec, ports)
```

**Capability layer** ([docs/CAPABILITIES-TDD.md](docs/CAPABILITIES-TDD.md)):
overlapping skills register as providers of versioned contracts
(`page-fetch@1`, `web-search@1`, …) with mandatory distinct traits; config
selects the provider + fallbacks; secrets are manifest-declared and scoped
per-registrable; every nested call carries a traceable chain. **Nothing is
enabled by default** — a registrable activates only with `enabled: true`.

A consumer calls `createAgentKit({ configDir, env, appName, resolver,
registrables, agents, schedules })` and `await kit.start()`.

## Framework, not deployment

`agent-kit` is the **reusable engine** — it ships no personas, no fleet, no
secrets. Its first consumer is **oslo**, which lives in the forest repo
(`apps/oslo` + `compose/oslo`; supersedes the separate `agent-oslo` repo per
[AGENT-SPEC.md](docs/AGENT-SPEC.md)) and supplies oslo's agent specs, persona,
config, local skills, and deployment. Alert delivery goes out through the
homelab notify webhook, not an in-framework agent. Dependency direction is
one-way: consumer → agent-kit. See [ARCHITECTURE §24](docs/ARCHITECTURE.md)
for the authoritative boundary and AGENT-SPEC §3 for the current placement.

## Design goals (one-liner each)

- **As few containers as possible — three:** the Bun runtime (all subsystems in-process), **Postgres** (pgvector/pgvectorscale — one store for memory/jobs/history/schedule/ledger), and **agent-browser** (Chromium isolated because it runs untrusted content).
- Dependency-injected with Effect `Context.Service` keys, an application
  `Layer`, and one `ManagedRuntime`; registrables activate lazily, with no
  reflection.
- Storage uses Effect SQL with `@effect/sql-pg`: scoped pools, typed SQL errors,
  reconnecting `LISTEN` streams, reserved advisory-lock connections, and the
  Effect migrator.
- Registry pattern for skills / MCP servers / plugins with a required-config contract.
- Adding features must not degrade performance — footprint accounting + a **split** CI gate (free static footprint gate every PR; paid quality gate nightly via Batch API).
- LiteLLM-driven tier/profile routing; token-efficient via **tool bundles + a search meta-tool** (keeps the prompt-cache prefix stable) and prompt caching.
- One OTel pipeline → SigNoz + Langfuse. **Prompts git-authoritative; no Sentry.**
- Self-improving from observation of its own behavior (proposals gated by A/B + a human via git PR).
- Background agents (`SKIP LOCKED` queue), a durable scheduler (`pg_advisory_lock`), durable memory **with injection provenance**.
- Generic web/browser only: agent-browser + Brave + Firecrawl (**no DataForSEO / SEO tooling**).

See the design doc for the full picture.
