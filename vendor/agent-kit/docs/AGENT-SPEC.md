# agent-kit — The Agent Spec (YAML DSL) & Repo Boundaries

> Status: **design, rev 2** (2026-07-21; rev 1 was `WORKFLOWS.md`, superseded —
> the format is an *agent definition*, not a workflow file). Companion to
> [`ARCHITECTURE.md`](ARCHITECTURE.md) (rev 4) and the capability layer built in
> `liminal/agent-kit` (`docs/CAPABILITIES-TDD.md`). Records the direction
> change: the consumer-facing surface becomes a GitHub-Actions-*style* YAML
> spec per agent, abstractions get renamed back to concrete things, and oslo
> moves into the **forest** repo (supersedes ARCHITECTURE §21/§23.7 on
> packaging; §24/§25 boundaries still hold).

---

## 0. Why this revision exists

agent-kit was meant to be the shared skills/framework extracted from
`~/code/oslo` and `~/code/tme/platform` — a youtube skill oslo uses for the
DVR; coding/debugging/writing skills dan and kathleen use with their own config
and domain logic on top. What got built in `liminal/agent-kit` is mechanically
sound but **relabeled the concrete world into abstractions** (a GitHub draft PR
became `change-proposal@1`; provider selection moved into config instead of the
caller's hands), which made it feel unusable even though nothing
domain-specific actually leaked in.

The fix is not a rewrite. A survey of all three codebases (2026-07-21)
established:

- **`liminal/agent-kit`** — the capability bus (contract-validated dispatch,
  provider + fallback, degrade-to-data), manifest-declared secrets (never
  inherited), semver pinning with shadowing, and call-chain tracing are built
  and tested (~194 TS files, 175 tests). No SEO/TMH logic leaked. The defects
  are naming and surface, not machinery.
- **`tme/platform`** — "kathleen" *is* `services/seo-agent`, "dan" *is*
  `services/dan-agent`. Kathleen's `assets/lists/seo-weekly.yaml` (per-weekday
  tool steps + report template + model choice) and oslo's per-agent
  `openclaw.json` (`tools.allow`, model, budget) are **this spec in embryo** —
  the two halves it unifies.
- **`~/code/oslo`** — a clawkit/OpenClaw *deployment* repo (~30 containers).
  The DVR is a **YouTube playlist curator** (Data API v3, no downloads): the
  generic engine belongs in agent-kit; the channel list, windows, and pakman
  stay oslo's.

---

## 1. The agent spec

**One YAML file defines one agent** — `agents/<name>.yaml` in the consumer
repo. It is the single source the runtime reads to know: who the agent is,
which models it uses, which MCP servers it connects to, what it may read and
write, which skills' tools it imports (**the model-facing tool file is
generated from this** — the successor to oslo's handwritten `tools.allow` and
tme's `toolFilter` prefixes), and what scheduled jobs it runs. GitHub Actions
supplies the vocabulary (`uses:` / `with:` / `secrets:` / `permissions:` /
`jobs:`); the semantics are reimagined for agents.

### 1.1 oslo's spec (the motivating example)

```yaml
# forest: apps/oslo/agents/oslo.yaml
name: oslo
persona: assets/prompts/oslo        # SOUL/STYLE/AGENTS markdown, git-authoritative
channels: [telegram]

model:
  default: fast                     # a TIER, never a model id — config maps
  # tier→model per env (llm.models table); consumer config overrides win.

config:                             # agent-personal values, referenced below as
  channels: [...]                   # ${{ config.* }} — data the spec's jobs use;
                                    # NOT framework config (that stays in config/)

mcp:
  - uses: mcp/memory@red-roster
    with: { url: "http://memory.internal/mcp" }
  - uses: mcp/web-search@red-roster
    secrets: { brave: ${{ secrets.brave_api_key }} }

permissions:                        # the read/write trust boundary, declared
  email: read                       # read → no write tools ever materialize
  imessage: read
  youtube: write                    # write → tools exist, approval-gated
  home-assistant: write
  github: none                      # explicit: this agent gets no github tools

tools:                              # skill imports → generates the tool registry
  - uses: browser@red-roster
  - uses: youtube@red-roster
    with: { approval: auto }        # low-stakes write (playlist insert), no gate
    secrets: { oauth: ${{ secrets.youtube_oauth }} }
  - uses: gmail@red-roster          # exposes only read tools — permissions say so
    secrets: { oauth: ${{ secrets.gmail_oauth }} }
  - uses: ./skills/pakman-latest-episode   # local skill: oslo-only code

jobs:
  youtube-dvr:
    on: { schedule: "0 * * * *" }
    steps:
      - id: uploads
        uses: youtube/channel-uploads@red-roster
        with:
          channels: ${{ config.channels }}     # oslo's list — config, not code
          window: { start: "06:00", end: "24:00" }
          min-duration: 300
      - id: pakman
        uses: ./skills/pakman-latest-episode
        with: { days: "mon-fri" }
      - uses: youtube/playlist-insert@red-roster
        with:
          items: ${{ steps.uploads.outputs.videos + steps.pakman.outputs.videos }}
          title-template: "{dayName}, {month} {day}{ordinal}"
          privacy: private

  morning-briefing:
    on: { schedule: "0 7 * * *" }
    steps:
      - id: digest
        uses: gmail/inbox-digest@red-roster
      - turn:                        # an agent turn: model + prompt + this agent's tools
          prompt: prompts/briefing.md
          model: standard            # per-job tier override
          context: { digest: ${{ steps.digest.outputs }} }
      - uses: notify@red-roster
        with: { channels: [telegram], body: ${{ steps.turn.outputs.text }} }
```

### 1.2 A kathleen-shaped spec (stays in tme; shown to prove coverage)

```yaml
name: kathleen
persona: assets/prompts/kathleen
channels: [slack]

model:
  default: fast

permissions:
  github: write            # draft PRs only — the skill never merges
  web: read

tools:
  - uses: browser@red-roster
  - uses: writing@red-roster
  - uses: github/draft-pr@red-roster
    secrets: { token: ${{ secrets.github_app }} }
  - uses: ./skills/seo     # the ENTIRE SEO kit stays kathleen's code

jobs:
  tuesday-draft:
    on: { schedule: "0 9 * * 2" }
    steps:
      - turn:
          prompt: prompts/tuesday-draft.md
          model: { tier: standard, profile: writing }
      - uses: notify@red-roster
        with: { channels: ["slack:#seo"], body: ${{ steps.turn.outputs.text }} }
```

### 1.3 The blocks

| Block | What it declares | What the runtime derives from it |
| --- | --- | --- |
| `name` / `persona` / `channels` | identity; prompt assets (consumer git files); which channel adapters listen | persona assembly, channel wiring |
| `model:` | **tiers and profiles, never model ids** — `default:` plus per-job/per-turn overrides | model routing; the tier→model table lives in consumer config (per env) and **config always wins**, so swapping a model is a YAML edit, not a spec edit |
| `mcp:` | MCP servers, `uses:`-style with `with:`/`secrets:` | lazy connections; discovered tools join the registry subject to `permissions:` and footprint budgets |
| `permissions:` | GH-Actions-style `read` / `write` / `none` per domain | **the trust boundary, §16, as data**: `read` → write tools never materialize for that domain; `write` → write tools exist behind the approval gate (a skill import may set `approval: auto` for low-stakes writes); `none` → nothing materializes. Read-only agents fall out of this block, not a separate agent taxonomy. |
| `tools:` | skill imports (`uses: <skill>@<ref>`, local `./skills/x`) with bound `with:`/`secrets:` | **generates the model-facing tool file**: JSON schemas + descriptions assembled from the imported skills, filtered by `permissions:`, bundled per ARCHITECTURE §10.1 (stable prefix + `search_tools` for the long tail) |
| `jobs:` | scheduled/triggered tasks: `on:` (schedule / message / event / manual), `steps:` | durable cron entries (§15); each step is either a deterministic `uses:` call or a `turn:` (model + prompt + this agent's tools, optional per-turn model/tool overrides) |
| `config:` | agent-personal data values (e.g. oslo's channel list), referenced as `${{ config.* }}` in jobs/tools | inline data — keeps personal values out of code and out of framework config |
| `secrets` | referenced as `${{ secrets.x }}`; **declared** by the skill manifest, **passed** explicitly at the import/step, never inherited | the consumer binds names in `config/secrets.yaml` (values are `${VAULT:…}`/`${ENV:…}` refs, resolved at load); values live only in process memory |

Step chaining (`${{ steps.<id>.outputs.x }}`) is schema-validated on both
sides — the producing skill's output contract and the consuming skill's input
contract — which is the capability bus's both-sides validation, re-surfaced.

### 1.4 Versioning: `@ref` is a git tag, debaser names it

No release pin anywhere in the spec. Exactly like GitHub Actions:

- **A ref points at a git tag.** `uses: youtube@red-roster` resolves against
  the agent-kit repo's tag `red-roster`. Local skills (`./skills/x`) have no
  ref — they ride the consumer repo's own commit.
- **Debaser names the tag.** Release flow: `git tag $(debaser <sha>) <sha>` —
  the name is *derived from* the SHA, deterministic and immutable. No
  `releases.yaml`, no index to maintain; `git tag -l` is the release list.
- **Each `uses:` resolves independently.** Two steps may pin different refs.
  Resolution happens **at deploy time**: the loader fetches each referenced
  skill's definition at its tag and writes a lockfile (`agent-kit.lock`:
  ref → sha → content hash), so runtime never touches the network and a
  deleted tag can't break a running agent.
- **Skills are versioned content, the engine is a dependency.** A skill at a
  tag = its manifest + prompts/descriptions + code, vendored at deploy (the
  same way the Actions runner fetches an action at a ref). The runtime engine
  itself is versioned separately through normal dependency management; a skill
  manifest may declare `engine: ">=x"` if it needs a newer runtime, and the
  loader fails loudly on a mismatch instead of degrading.

### 1.5 The non-obfuscation rule

- **Concrete names.** The skill is `github`, not `change-proposal`; `youtube`,
  not `media-source`. An abstraction earns a generic name only when **two or
  more real providers** exist behind it.
- **Genuine seams keep their contracts.** `metric-rows@1` (kathleen supplies
  GSC/GA4 rows), `issue-feed@1` / `change-feed@1` (dan supplies Sentry/deploy
  feeds) are real "consumer supplies the data source" interfaces — exactly
  what lets SEO stay in kathleen's repo.
- **The consumer-facing surface is the spec + plain local-skill functions.**
  Framework internals (Effect, the bus, the registry) never leak into a spec
  file or a local skill's authoring experience.

---

## 2. Renames and deletions in the current implementation

| Item | Action | Reason |
| --- | --- | --- |
| `change-proposal@1` (contract + provider) | **Rename → `github/draft-pr`** | one provider (GitHub), PR-shaped fields (`branchSuffix`, `edits`, `creates`); the generic name hides a concrete thing |
| `experiment@1` | **Delete** | contract-only — no provider, no consumer |
| distinct-traits rule (`index-validation.ts`) | **Drop (delete the mechanism)** | invented differentiation axis; dead weight once the caller names the skill in `uses:` |
| config `capabilities.<ref>: {provider, fallback}` selection | **Replace** with the spec's `uses:`/`tools:` blocks | the caller names the skill; config no longer picks providers behind the caller's back |
| `metric-rows@1`, `issue-feed@1`, `change-feed@1` | **Keep as-is** | genuine consumer-supplied data-source seams |
| capability bus, registry, semver, secrets, chain | **Keep** — becomes the spec runtime | the machinery under `uses:`/`with:`/`${{ secrets.x }}` |
| trust plugins, store, channels, scheduler, jobs, observability, footprint | **Keep** | runtime spine; not part of the mislabeling problem |
| SEO/tmh vocabulary in comments | **Sweep** | cosmetic residue |

---

## 3. Boundaries — what lives where

Extends ARCHITECTURE §24/§25 with the spec and the new repo placement.

### 3.1 agent-kit (`~/code/agent-kit`)

The `liminal/agent-kit` implementation **merges into this repo** (which holds
ARCHITECTURE.md; its "no runtime code yet" status is stale).

- **Runtime:** agent loop, registry, spec loader/runner, scheduler, jobs,
  memory, Postgres store, channel adapters (telegram/slack/imessage/http),
  trust/approval plugins, observability, footprint, self-improve.
- **Spec machinery:** parser, `${{ }}` interpolation, tag/lockfile resolver,
  manifest disk-loader, local-skill loading, tool-file generation.
- **Generic skills:** `browser`, `brave`, `firecrawl`, `webpage`, `sitemap`,
  `page-audit`, `github` (draft-pr / issues / actions), `youtube` (Data-API
  engine: channel-uploads, playlist ops, OAuth token cache), `gmail`
  (read/write, opt-in), `writing` (investigator / fix-drafter / anchored
  edits), `watch` (trend/diff/outcomes), `sentry/issues` (Sentry-protocol
  client — works against GlitchTip; the Sentry **SDK** stays excluded per
  §25), `reminders`, `notify`, the `mcp/*` server clients.

### 3.2 oslo (forest repo: `apps/oslo` + `compose/oslo`)

Supersedes the separate `~/code/agent-oslo` repo decision; that stub is
retired. Everything that makes oslo *oslo*:

- **Agent specs:** `agents/oslo.yaml` (and read/write specialist specs as they
  migrate: imessage, email, home-assistant, security) — jobs: youtube-dvr,
  morning-briefing, inbox-digest/clean, heartbeat-distill, oslo-learning,
  imessage-review.
- **Local skills:** `pakman-latest-episode`, `cvs-refill`,
  `lillydirect-refill`, breaking-news feed config.
- **Persona/prompts** (git assets), **secrets** (Vault paths, sealed env),
  **deploy** (`compose/oslo`: agent-kit runtime + Postgres + agent-browser —
  three containers replacing ~30 — riding the forest deploy pipeline).

### 3.3 teachmehipaa (`tme/platform` — stays put; migration not planned here)

- **Stays TMH:** the entire `seo/*` strategy kit as a local skill
  (`./skills/seo`) **including** the DataForSEO / Search Console / GA4 /
  PageSpeed clients (they are SEO work, per §25); dan's `ops/*` platform
  writes; `user_lookup` / magic-link / cert tools; Stripe wiring; personas,
  roster, social layer; `seo-weekly` rewritten as jobs in kathleen's spec.
- **What TMH needs from agent-kit** (so the framework must ship it): `turn:`
  steps with per-turn model/tool overrides and report delivery, the draft-PR
  pipeline with confidence gating and approval gates, per-agent browser
  sessions, local-skill loading, the `permissions:` write gate. All covered
  in §1.

---

## 4. Oslo rebuild plan

1. **Repo moves.** Merge `liminal/agent-kit` → `~/code/agent-kit` (keep
   ARCHITECTURE.md + CAPABILITIES-TDD.md + this doc). Scaffold `apps/oslo` +
   `compose/oslo` in forest.
2. **Spec foundation.** Spec parser + `${{ }}` interpolation, tag/lockfile
   resolver, manifest disk-loader, tool-file generation from
   `tools:`+`permissions:`, plus the §2 renames/deletions. **Tag the first
   debaser release immediately after** — every spec is born pinned.
3. **Port the skills oslo needs.** Extract the youtube engine from
   `oslo/skills/youtube-dvr/run.py` (channel-uploads, playlist idempotency,
   OAuth cache) minus personal config; gmail read/write largely exists in the
   email pack; `notify` is a thin webhook client; the web pack exists.
4. **First job end-to-end: `youtube-dvr`.** Self-contained, low-risk, obvious
   success signal (today's playlist exists and matches), and it exercises
   `on: schedule` + `uses:` + a local skill (pakman) + secrets in one shot.
   Run in forest alongside the legacy container, compare outputs for a few
   days, then disable the old one.
5. **Migrate in risk order.** Briefing + inbox digest/clean → memory
   ingest/distill jobs → the read/write specialists (imessage, email,
   home-assistant, security) as specs with `permissions:` expressing the
   envelope boundary → the Playwright refill flows **last** (highest-stakes
   browser automation; they may stay legacy containers indefinitely). Then
   decommission the clawkit stack.
6. **Hygiene fixes found in the survey:** sealed env files currently hold live
   plaintext secrets on disk (move to Vault AppRole resolution at boot,
   ARCHITECTURE §5); personal defaults baked into code (`pakman/fetch.py`
   username, hardcoded LiteLLM URLs) become config.

---

## 5. Open decisions

1. **`gmail` in agent-kit vs. consumer.** Recommend agent-kit (opt-in):
   dan/kathleen-class agents will want mail, and it has no operator specifics
   once config is external.
2. **Permissions granularity.** v1 is per-domain `read`/`write`/`none` +
   per-import `approval: auto`. Decide later whether per-operation grants
   (`youtube: {playlists: write, uploads: read}`) are worth the surface —
   recommend not until a real case demands it.
3. **Mixed refs in one process.** Independent per-`uses:` refs are the model
   (§1.4); the lockfile makes it deterministic. If vendoring multiple versions
   of a *code* skill in one runtime proves painful in practice, the fallback
   is a loader warning nudging refs into agreement — never a hard top-level
   pin.
