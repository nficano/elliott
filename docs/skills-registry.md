# Installable skills: the `nficano/skills` registry

Status: IMPLEMENTED (v2 design) · 2026-07-29 — see §15 for what shipped and the
open deploy-time follow-ups.

Elliott today loads skills from exactly two places on disk: the framework's
`skills/` directory (`loadBundledPackages`, `src/catalog/bundled.ts:18`) and the
agent repo's `agents/<name>/skills/` (`loadAgentSkillPackages`,
`src/catalog/bundled.ts:27`). There is no remote acquisition, no versioning
(`metadata.version` is schema-validated then dropped by the loader), and the
only pin anywhere is tide-pods pinning the *entire* framework by git SHA.

This design adds a third package source — **installed skills** — resolved from a
public registry repo, `github.com/nficano/skills`, with per-skill semver tags.
It also slims the framework's built-in set to eight skills and defines the
migration for everything else.

> **This is design v2.** A three-lens adversarial review (security/supply-chain,
> operations/rollout, architecture/correctness) demolished two load-bearing
> assumptions in v1 — that `<agentRoot>` is writable at runtime, and that the
> bundled skills could stay as a "fallback" during cutover. Both were false and
> each independently produced a non-booting or zero-gateway production oslo. The
> full list of what changed and why is in §14. The short version: **installation
> is a build/CLI-time step producing a committed, authoritative lock; boot-time
> "latest" resolution is an optional refresh that only runs where state is
> writable; fetch/extract uses the system `tar` (GitHub tarballs are pax, not
> ustar); and the `SkillContext` handed to skills is scoped, never the global
> secret bag.**

## 1. Goals and non-goals

Goals:

- A public monorepo `nficano/skills` where each skill is a directory using the
  exact same package contract as today (`manifest.yaml` + kind doc + `src/`
  with `register(context)`). No second contract.
- Users install a skill by declaring it in config. Unpinned entries resolve to
  the latest tag; pinned entries are exact.
- **Deterministic, offline-safe production boots.** The committed lockfile is an
  authoritative pin (exact version + content digest), the install is materialized
  into the image at build time, and a booted container never depends on GitHub.
- Elliott ships with built-ins only: `fetch`, `evaluator/*`, `files`,
  `mcp-client`, `scheduler`, `ssh`, `terminal`, `deep-trace` (the renamed
  `telemetry-map`).
- Installed skills are first-class: same loader, same facility system, same
  governance (ToolGovernor wraps their tools identically), same appearance in
  `SkillContext.packages()` and therefore on the deep-trace map.

Non-goals (v1):

- Semver ranges (`^1.2`). Only exact pin or "latest at resolve time".
- Per-skill source overrides / multiple registries per agent.
- npm dependencies inside registry skills. Registry skills may import only
  `elliott/*` subpath exports and Bun/Node builtins (elliott itself depends only
  on `effect` + `yaml`; the audited migration set imports exactly five framework
  modules, all already exported — §5.1). Registry CI enforces this.
- A general-purpose public ecosystem. This is Nick's registry; the trust model
  assumes the registry owner is the operator and that **every published tag is
  operator-reviewed** — third-party PRs are never auto-tagged.

## 2. The split

Built-in (stay in elliott `skills/`):

| Skill | Notes |
| --- | --- |
| `fetch` | no deps |
| `evaluator/dspy`, `evaluator/darwinian`, `evaluator/agent-benchmarks` | coupled to the evolution runtime (`evaluator.gauntlet`); meaningless outside the framework |
| `files` | no deps |
| `mcp-client` | the "mcp" built-in; keeps its `mcp-client` name (renaming churns `agent.yaml` component refs for no benefit) |
| `scheduler` | delivers via primary gateway when one exists; see the soft-delivery fix below |
| `ssh` | no deps |
| `terminal` | no deps |
| `telemetry-map` → `deep-trace` | see §10; consumes `proxy.route@1` + `dns.local@1`, see edge below |

Moving to `nficano/skills` (directory = `metadata.name`, flattened — the
`gateway/`, `search/`, `web/` category dirs do not carry over):

`browser`, `cloudflared`, `code-review`, `debugging`, `gateway-slack`,
`gateway-gmail`, `gateway-email`, `gateway-bluebubbles`,
`gateway-home-assistant`, `gateway-webhook`, `news-brief`,
`pakman-latest-episode`, `pihole`, `research`, `search-brave`,
`search-duckduckgo`, `subscription-usage`, `traefik`, `web-firecrawl`,
`web-parallel`, `webhook-provisioner`, `youtube-dvr`.

Cross-bucket / cross-skill edges and how each is handled:

- **deep-trace → traefik + pihole** (`proxy.route@1`, `dns.local@1`). deep-trace
  stays built-in but consumes facilities from two skills that move out. The
  acquire calls (`publish.ts:30,41`) are already try/caught and only fire when
  `public_hostname`/`service_url` are configured, so a fresh elliott without
  those skills serves the map locally and skips LAN publish. The manifest's
  `facility.use` stays declared; acquiring an absent facility errors *at acquire
  time*, which publish.ts absorbs. The `local-publish-smoke` integration test
  and `local-network` e2e (which load pihole+traefik+telemetry-map together)
  move to the registry repo's suite (§9); elliott keeps a test asserting publish
  degrades cleanly when no provider exists.
- **scheduler → primary gateway.** `context.deliver` throws
  `"No gateway is available for delivery"` (`app.ts:345`) when no gateway is
  installed; scheduler awaits it (`scheduler/src/index.ts:95`), so a
  gateway-less boot re-throws every tick and spams the reporter. **Fix (ships
  with this feature):** `#deliver` becomes soft — no primary gateway ⇒ it
  records a single "delivery unavailable" report and returns, and scheduler
  marks the item handled so it doesn't re-fire. This is a genuine soft-degrade,
  not the false claim v1 made.
- **youtube-dvr → pakman** is a *relative cross-package import*:
  `youtube-dvr/src/providers.ts:3` does
  `import { makePakmanResolver } from "../../pakman-latest-episode/src/resolver"`.
  Under the versioned cache layout that `../../` escapes the skill and the file
  isn't even in youtube-dvr's tarball, so the import throws at register and the
  skill silently drops. **Fix (prerequisite to migration):** vendor the small
  `makePakmanResolver` into `youtube-dvr/src/` (pakman-latest-episode keeps its
  own copy). No cross-package relative import survives into the registry. CI
  rejects any `../../<sibling-skill>` import (§9).
- **gateway-slack → webhook-provisioner → cloudflared** and
  **news-brief → gateway-slack**: all endpoints move together; no framework edge.

Framework cleanup on removal (the review found v1 undercounted this — full list
so step 5's `bun run check` isn't a surprise yak-shave):

- Prune moved entries from `BUNDLED_CATALOG` (`src/catalog/index.ts`).
- Update tests that assert the catalog: `test/unit/bundled-skills.test.ts`,
  `test/unit/phase-two-data-plane.test.ts:23,27` (asserts `search-duckduckgo`,
  `gateway-bluebubbles`), and the `contract-smoke` counts snapshot.
- Move or delete unit tests importing moved skill sources:
  `slack-gateway.test.ts`, `slack-agent.test.ts`, `bluebubbles-gateway.test.ts`,
  `duckduckgo-search.test.ts`, `webhook-profiles.test.ts`.
- Move integration/e2e smokes that load moved skills to the registry suite:
  `bluebubbles-webhook-smoke`, `gmail-webhook-smoke`, `subscription-usage-smoke`,
  `webhook-facility-smoke`, `webhook-route-smoke`, `local-network-smoke`,
  `local-publish-smoke`, `test/e2e/skills/local-network.e2e.test.ts`.
- Prune the 16 moved names from `agents/elliott.yaml` `spec.components` (stale,
  not fatal — the runtime reads only `persona`/`mcp` from it — but leave it
  clean).
- Re-home the evolution catalog: `.elliott/evolution-targets.yaml` targets
  `skills/code-review/SKILL.md`, `skills/research/SKILL.md`,
  `skills/debugging/SKILL.md` — all moving. Prune these targets (or repoint the
  evolution catalog at built-ins) or the live evolution stack has dangling
  baselines.
- Regenerate topology JSON (`scripts/gen-topology.mjs`).
- Typed settings loaders for moved skills stay in the framework for v1 (§6) —
  deliberately transitional; they are pure config parsing (no fs access), so
  they don't break when the skill dirs are deleted.

## 3. Registry repo layout and tagging

```
nficano/skills
├── README.md                 # what this is, how installation works
├── .github/workflows/ci.yml  # validation, see §9
├── traefik/
│   ├── manifest.yaml         # metadata.name MUST equal the directory name
│   ├── EXTENSION.md
│   └── src/…                 # imports only elliott/* + builtins + own ./relatives
├── pihole/…
├── gateway-slack/…
└── …
```

No `package.json` anywhere inside a skill directory. (Verified: a nested
`package.json` shadows elliott's package self-reference and breaks
`import "elliott/skills"` in dev mode — CI and the installer both reject it.)

Versioning: per-skill git tags `<name>/v<major>.<minor>.<patch>`, e.g.
`traefik/v1.0.0`. At the tagged commit the skill's `metadata.version` must equal
the tag version (CI-enforced at tag push; the installer re-verifies).

"Latest" = **semver-max**, not chronologically newest: the highest
`major.minor.patch` among tags matching `<name>/v*` that parse as exactly three
integers. Prerelease/build suffixes are excluded from latest-selection.

Current manifest versions are the starting tags (they are **not** uniformly
`1.0.0` — `gateway-slack` is already at `2.0.0`; each skill tags at its own
manifest version).

## 4. Config surface

New top-level block in `config/elliott.yaml` (agent root), parsed by
`loadRuntimeSettings` into `RuntimeSettings.install`:

```yaml
install:
  registry: nficano/skills        # owner/repo on github.com
  refresh: false                  # default; true only where state is writable (dev)
  skills:
    - traefik                     # unpinned → resolves to latest at install time
    - pihole@1.0.0                # pinned → exactly this tag
    - gateway-slack@2.0.0
```

- Entry grammar: `name` or `name@version`; `name` matches `[a-z][a-z0-9-]*`,
  `version` matches `\d+\.\d+\.\d+`. Anything else is a **fatal** config error
  (explicit operator intent).
- Duplicate names: fatal config error.
- A name colliding with a built-in or agent-local skill: fatal config error at
  merge time (§7).
- **An unknown skill name with no lock entry is fatal**, not a silent skip — a
  grammar-valid typo (`gateway-slcak`) could never have been a working config,
  so it fails loud (this closes the v1 taxonomy inversion the review caught).
- `refresh: true` opts a *writable* environment into boot-time latest
  re-resolution (§5.3). Production leaves it `false`; the baked lock is law.
- Absent `install:` block: feature entirely inert; zero behavior change.

Installed skills read runtime config via the scoped `SkillContext` (§6).

## 5. Installation and version resolution

### 5.1 One resolver, two invocation points

There is a single code path — the **installer** — exposed as a CLI subcommand
`elliott skills install [--frozen] [--refresh]`. It is invoked in two places:

1. **Image build (authoritative, network available).** The agent repo's
   Dockerfile runs `elliott skills install --frozen`. `--frozen` reads the
   committed `skills.lock.json`, fetches exactly the locked tags, verifies each
   against its locked digest, and materializes the cache into an image layer. No
   "latest" resolution happens here — the lock is law. Build fails loudly if the
   registry is unreachable or a digest mismatches (the correct place to fail).
2. **Boot (optional refresh, only where writable).** In dev / any environment
   with `refresh: true` and writable state, `ElliottRuntime.start()` runs the
   installer between `loadRuntimeSettings` and package discovery (`app.ts:132`),
   re-resolving unpinned entries against live tags and rewriting the lock. In a
   read-only production container this step is a no-op read of the baked cache.

This preserves the "latest is resolved dynamically, not hardcoded in source"
requirement — resolution is driven by config and the live registry — while
making the *production* boot deterministic and offline-safe. "Latest" is
resolved when you build/refresh, and that resolution is frozen into the
committed lock that ships to production.

Installed packages join the same `loadSkillRegistrations` two-pass (facility
providers first) as bundled and agent-local skills; module resolution of
`elliott/*` from the cache dir is verified working in both dev self-reference and
tide-pods walk-up.

### 5.2 Frozen install (build / `--frozen`)

For each locked entry `{name, version, tag, digest}`:

1. Group entries by the git commit their tag points to (from the refs listing,
   dereferencing annotated tags). Fetch each **unique commit's tarball once** —
   not once per skill — since a bulk tag drop shares one commit. This bounds
   downloads to the number of distinct commits, and one whole-repo download
   yields many skills.
2. Fetch `https://codeload.github.com/<owner>/<repo>/tar.gz/refs/tags/<tag>`.
   Stream to a temp file with a **hard byte cap** on both the compressed
   download and the decompressed output (guards a malicious/oversized gz).
3. Extract with the **system `tar`** (`tar -xzf … -C <tmp> --one-top-level`),
   not a hand-rolled reader. GitHub/`git archive` tarballs are **pax** format
   (leading `pax_global_header` with the commit sha, per-file `x` extended
   headers for long paths) — a bespoke ustar parser mis-reads them. `tar`
   handles pax, long names, and refuses nothing we need; we then whitelist only
   the skill subtree we extract (regular files + dirs), rejecting any entry that
   escapes it.
4. The tarball's top-level directory name is **read from the extraction**, never
   computed — GitHub's name is `<repo>-<tag-with-slashes-as-dashes>` and does
   *not* consistently strip the leading `v` for slashed tags (verified:
   `skills-traefik-v1.0.0`). Copy `<root>/<name>/**` into
   `cache/<name>/<version>/` via temp-dir + atomic rename **on the same
   filesystem** (avoids EXDEV between tmpfs and the cache volume).
5. Validate: manifest parses; `apiVersion: elliott/v1`; `metadata.name == name`;
   `metadata.version == version`; `spec.document` in the allowed set; entrypoint
   exists; **no nested `package.json`**; no `../<sibling>` imports. Any failure
   → reject (cache nothing), fatal in `--frozen`.
6. Compute the **all-files digest**: sha256 over every extracted file's relative
   path + bytes, sorted (the `check-evolution-image-lock.py` recipe — hashes
   paths too, so an undeclared extra file changes the digest). **This digest
   must equal the locked digest**, or the install fails. This is what makes the
   committed lock a real pin: the bytes are verified against the lock on every
   fetch, cold cache or warm.

### 5.3 Refresh (boot with `refresh: true`, writable only)

Trust-on-first-use with an authoritative lock:

1. One tag listing for the whole registry:
   `GET /repos/<owner>/<repo>/git/matching-refs/tags/`. This endpoint returns
   **all** matching refs in a single response with **no `Link` pagination**
   (verified) — consume the full array, set a sanity bound, do not wait on a
   `Link` header that never comes. If `secrets.github_token` resolved, send it
   as bearer (lifts 60→5000/hr).
2. For each entry: pinned → the pin; unpinned → semver-max. Cross-check a pinned
   tag against a direct `git/refs/tags/<name>/v<version>` lookup rather than
   trusting one unbounded blob.
3. **Unpinned float is gated, not automatic.** If semver-max is *higher than the
   locked version*, that is a candidate, not an auto-apply: the installer
   fetches + validates it and updates the lock **only during an explicit refresh
   run** (`--refresh` / `refresh: true`). It logs the version change. This means
   a single pushed `traefik/v99.0.0` cannot silently become law on the next
   production restart — production never refreshes; a human runs refresh, sees
   the bump, and commits the new lock. (First-install of a brand-new entry with
   no lock line does fetch latest and record it — the one unavoidable TOFU
   moment, same as any package manager.)
4. Fetch/extract/validate/digest exactly as §5.2. Write the updated lock
   atomically (temp + rename, same dir).

### 5.4 Degraded boot (refresh path, registry unreachable)

- Every entry with a lock line + intact cache loads from cache (the normal
  offline path — one `report()` for the listing failure, not one per skill).
- Entries with no lock/cache are skipped and reported; boot proceeds degraded
  (consistent with the existing "a failed `register()` never kills boot"). But
  see §7 — a *degraded* boot must not report itself *healthy*.

## 6. How installed skills read config — scoped `SkillContext`

The review found a real, registry-independent hole: `SkillContext.settings` is
the entire `RuntimeSettings` — every API key, every gateway token, and
`governance.controlToken` (the kill-switch bearer) — handed to every skill's
`register()`, which is arbitrary code that runs at import time *before*
ToolGovernor wraps anything. A malicious or buggy skill exfiltrates the lot
before a single tool call is governed.

v1 fix (ships with this feature, applies to **all** skills, built-in and
installed):

- **`governance` / control-plane secrets are never placed on any
  `SkillContext`.** The kill switch's bearer token cannot be read by skill code.
- Installed skills receive a **scoped settings view**: their own config block
  (`skills.<snake_case(name)>` / the relevant `tools.*`/`gateways.*`/`channels.*`
  block their manifest maps to) plus only the `secret://` grants their manifest
  declares — not the global secret bag.
- For the migration's *code* diff to stay import-only (§12 step 3), the migrated
  skills keep reading their existing typed settings fields for now, but those
  fields are populated into the scoped view rather than the global object. The
  redaction of control-plane secrets is unconditional.

Forward path (follow-up, not v1): collapse the typed loaders into a generic
per-package `SkillContext.config` (raw block, secrets pre-interpolated), scoped
exactly like facilities are, after which each skill drops its typed loader and
`RuntimeSettings` sheds the dead fields. Prioritized for the gateways, since
their config shape is most likely to drift ahead of the framework pin.

## 7. Merge, collisions, and failure surfacing

- Package list order: `bundled ++ installed ++ agent-local`, then the existing
  duplicate checks. A `metadata.name` collision across any two sources is a
  **fatal boot error** naming both directories (mirrors `collectTools`'s
  fail-fast on duplicate tool names). Precedence/shadowing via the kernel
  `ComponentRegistry` is explicitly out of scope.
- **A degraded boot is not a healthy boot.** Today `health.ready` is set true
  unconditionally (`app.ts:203`) and `deploy-spruce.sh` gates only on HTTP 200,
  so a zero-gateway oslo deploys green. This feature adds:
  - a `required` marker on install entries (default: gateways are required);
  - a new `install` section in `/healthz`:
    `{skill, requested, resolved, state: ok|cached-fallback|failed, error?}`;
  - `health.ready` is **false** if any `required` install entry is not `ok`;
  - the deploy script asserts the `install` section is all-ok and the resolved
    gateway set is non-empty before declaring success.
- **What a human sees.** Install failures `report()` to GlitchTip (survives
  independently of Slack) and surface in `/healthz`. Because the usual alert
  channel (Slack) may itself be the failed skill, the deploy gate — not a Slack
  message — is the primary signal, and the GlitchTip path is the backstop.
- Config errors (bad grammar, duplicate, collision, **unknown-name-with-no-lock**)
  are fatal. Environmental errors (registry down, single missing cached skill
  that isn't `required`) degrade.

## 8. Cache and lockfile

- **Cache location:** `<agentRoot>/.elliott/skills/<name>/<version>/…`. In the
  read-only oslo container this is **populated at image build** (§5.1) and
  mounted read-only at runtime. `discoverPackageDirectories` is **never pointed
  at the cache root** (it would recurse into every retained version → duplicate
  names → boot crash); the installer hands `loadPackage` each exact
  `<name>/<version>` directory (a small `export`/wrapper around the currently
  module-private `loadPackage`).
- **Lockfile:** `<agentRoot>/skills.lock.json`, **committed** in the agent repo:

```json
{
  "version": 1,
  "registry": "nficano/skills",
  "skills": {
    "traefik": {
      "version": "1.0.0",
      "tag": "traefik/v1.0.0",
      "digest": "sha256-…",
      "pinned": false
    }
  }
}
```

  - No `resolvedAt` in the committed artifact (it churned whole-file diffs and
    obscured real version changes); provenance timestamps, if wanted, go to a
    gitignored sidecar.
  - **The committed lock is authoritative.** `--frozen` verifies fetched bytes
    against `digest`; a mismatch fails the build. Two containers built from the
    same committed tide-pods get byte-identical skills regardless of what tags
    landed upstream since.
  - The in-container runtime lock is **never authoritative** and, in production,
    never written (read-only). Only `--refresh` (dev / CI bump job) rewrites the
    committed lock.
  - Entries for skills no longer in config are pruned on the next refresh.
    Changing the `registry` field is **advisory** — it does *not* silently
    invalidate existing digests (that was a downgrade lever); a registry change
    is a loud, operator-confirmed refresh.
- **Lock generation.** `elliott skills lock` resolves all unpinned entries to
  their current semver-max, fetches+digests, and writes the committed lock. Run
  in a CI bump job (bot PR when registry tags land) or by hand; never "boot a
  runtime and copy the file out".
- **Gitignore + volume.** Both repos add `.elliott/skills/` to `.gitignore`
  (verified: currently NOT ignored in either). The oslo image bakes the cache
  layer; no runtime volume is required for it (build-time install removes the
  cold-boot fetch entirely).

## 9. Testing and registry CI

Elliott-side (hermetic, no network):

- Unit: entry grammar, semver-max (incl. prerelease exclusion, single-response
  refs listing, sanity bound), the digest recipe, lock read/write/prune, frozen
  vs refresh, the "unpinned-higher-tag is a candidate not auto-applied" gate,
  registry-change-is-advisory, tar extraction against a **golden real codeload
  pax tarball** (not a hand-rolled ustar fixture) including hostile entries
  (`../` escape, absolute path, symlink, nested `package.json`, `../<sibling>`
  import) all rejected, and decompression-bound enforcement.
- Integration: installer against a **local fixture registry** (a Bun server
  serving canned `matching-refs` JSON + real `tar.gz` blobs; registry base URL
  overridable via settings for exactly this) → resolve, frozen-install, boot a
  runtime whose package list includes the fixture skill, assert its tool
  registers and executes; offline boot from baked cache; collision → fatal;
  unknown-name-no-lock → fatal; degraded-but-not-required → `ready:true`;
  missing-required-gateway → `ready:false`.
- `contract-smoke` keeps guarding built-ins with updated counts.
- Scoped-context test: a skill's `register()` cannot read `governance.controlToken`.

Registry-side CI (`nficano/skills`):

- Every push/PR: manifest schema validation (vendored `elliott-component.json`),
  directory-name == `metadata.name`, no imports outside `elliott/*` + builtins +
  own `./` relatives (rejects `../<sibling>`), **no nested `package.json`**,
  typecheck + `register()` contract smoke against a **pinned elliott** (private
  dep via read-only deploy-key secret — fork PRs can't run it; acceptable for a
  personal registry).
- Tag push `<name>/v*`: assert tag version == that skill's `metadata.version` at
  the tagged commit; assert that skill dir passed validation.
- The moved multi-skill integration tests (`local-publish-smoke`,
  `local-network` e2e) live here and run against the pinned elliott.

## 10. Rename: `telemetry-map` → `deep-trace`

Scope: package identity, not routes. `/v1/observability/map` and subpaths stay
(the Nuxt app, its committed `dist/`, fonts, canary probe, and published
hostname all key on the route — live infrastructure).

- `skills/telemetry-map/` → `skills/deep-trace/`; `metadata.name`,
  `BUNDLED_CATALOG` descriptor, gateway `name` literal (`src/gateway.ts:13`)
  **and the matching `gateway: "telemetry-map"` on the synthesized inbound
  message (`src/index.ts:165`)** — both must move in lockstep or `#replyGateway`
  (`app.ts:357-362`) silently falls back to Slack. Also the service binding
  name, channel `deep-trace:interactive`, error tags, and the SSE opening
  comment (`src/sse.ts:5`, asserted at `sse.test.ts:46` + `routes.test.ts:383`).
- Settings: config key `skills.telemetry_map` → `skills.deep_trace` in **both**
  `settings-skills.ts:72` and elliott's own `config/elliott.yaml` (~line 124)
  and tide-pods `config/elliott.yaml:161`; `TelemetryMapSettings` →
  `DeepTraceSettings`; `settings.telemetryMap` → `settings.deepTrace`. To avoid
  a silent flag-day outage of the *live* published map, the loader **accepts
  both keys for one release** (old key → deprecation warning), then drops the
  old key.
- Tooling excludes (`tsconfig.json:31`, `dprint.json:17`, `eslint.config.js:57`,
  `.dockerignore:20-24`), test dir `test/unit/telemetry-map/` →
  `test/unit/deep-trace/`, `deploy/compose.telemetry-map.override.yml`, the e2e
  harness, and cosmetic stragglers (`gen-topology.mjs:258`, comments in
  `telemetry.ts:14`, `types.ts:515`, `catalog/types.ts:45`).
- **Persisted-state migration** (the review's catch): the Traefik router
  `elliott-telemetry-map-public` and facility grant `telemetry-map-public` live
  in the `elliott-runtime` **volume** (`facilities/grants.json`,
  `traefik/routes.json`) and survive container replacement, so after the rename
  two routers serve the same host rule. Ship a **one-shot boot migration** in
  the rename commit: if the legacy grant/route key exists, release/rewrite it to
  the new name — not "one-time manual surgery on a volume". Orphaned session
  conversation ids (`telemetry-map:telemetry-map:interactive:root`) are cosmetic
  discontinuity; left as-is.
- The committed `dist/` contains the string "telemetry-map" in two **cosmetic**
  places (an error string + a copy line in `_nuxt/CRc73fKd.js`); nothing
  functional keys on it, so no dist rebuild is required — but the v1 claim
  "nothing in dist embeds the name" was wrong and is corrected here.
- Docs: `docs/telemetry-map-plan.md` → `docs/deep-trace-plan.md`; app package
  name `telemetry-map-app` → `deep-trace-app`; regenerate topology JSON.

## 11. Rename: `companions` → `darwin`

Scope guard: the repo has **two** unrelated "companion" concepts. Only the
evolution layer renames. The generic sidecar abstraction (`CompanionManager`,
`CompanionDeclaration`, manifest `companion(s)` fields in `src/placement`,
`src/catalog`, `src/memory`, `schemas/elliott-component.json`, browser/cloudflared
manifests) keeps its name — a Chromium sidecar is not "darwin".

- `companions/` → `darwin/`; `tsconfig`/`pyrightconfig` includes; the three
  scripts (`check-evolution-companions.sh` → `check-darwin.sh`, build, smoke)
  and their 36 path literals in `check-evolution-image-lock.py`; `package.json`
  scripts `companions:*` → `darwin:*` (+ the `check` aggregate); artifact path
  `.artifacts/evolution-companions/` → `.artifacts/darwin/`; container WORKDIR
  `/opt/elliott/companions/…` → `/opt/elliott/darwin/…` in the Dockerfiles and
  the smoke exec; internal `Companion*` types in `darwin/runtime` → `Darwin*`.
- Env vars `ELLIOTT_COMPANION_{FIXTURE,TOKEN,PLATFORM}` → `ELLIOTT_DARWIN_{…}`
  atomically across compose + scripts + container code (one commit; images
  rebuild on deploy). The Vault key is already evolution-named — no vault change.
- `images.lock.json`: digests hash relative path strings, so the rename
  invalidates every digest even with identical bytes. Recompute the lock and
  rebuild images as part of the rename commit (`bun run check` gates it).
- **Deliberately NOT renamed** (persisted/serialized contracts): the Effect
  schema tag `EvolutionCompanionDeploymentEvidence`
  (`acceptance.ts:24`) and the acceptance requirement-ID strings
  `companion.<engine>.{digest,platform,deployment,present}` — changing them
  breaks decoding of stored acceptance evidence for zero functional gain.
  Documented as legacy wire names.
- **Deploy reality (review's catch): elliott no longer has a deploy pipeline
  that rebuilds the companions.** elliott CI only tests; tide-pods' deploy builds
  only oslo; the evolution stack on spruce came from the retired elliott compose.
  `scripts/deploy-spruce.sh` still `compose up`s a retired `elliott` runtime
  service that binds port 18082 (conflicts oslo) and mounts oslo's external
  volumes (`elliott-runtime`, `elliott-postgres`) — running it would put a second
  runtime on oslo's `sessions.sqlite` and Slack socket. So, before §11 lands:
  1. Split the evolution stack into its own compose file/profile with **no
     `elliott` runtime service**, and a documented deploy command.
  2. Add an explicit rollout sub-step: rebuild + redeploy the darwin images
     (new `images.lock.json` digests, renamed `ELLIOTT_DARWIN_*` env),
     draining any in-flight evolution proposals first — otherwise self-evolution
     acceptance fails for every engine (the deliberately-kept
     `companion.<engine>.digest` IDs compare against the recomputed lock).
- Naming adjacency, accepted: `darwin/optimizers/darwinian/` and the existing
  `docs/darwin/` docs dir, which this rename aligns with.

## 12. Rollout

The v1 order self-destructed (bundled skills + installed skills of the same name
= collision = non-boot). Corrected sequence:

1. **Installer + safety fixes land in elliott** (this repo, pure addition,
   `install:` absent everywhere): settings block, CLI (`install`/`lock`), frozen
   + refresh resolvers, system-`tar` fetch/extract with size caps, cache/lock,
   scoped `SkillContext` + control-token redaction, soft `#deliver`, `/healthz`
   install section + `required` markers, fixture-registry tests. No skill moves.
2. **Renames land in elliott**: deep-trace (§10, incl. the one-shot grant/route
   migration and accept-both-keys) and darwin (§11, incl. the evolution-stack
   compose split + companion rebuild/redeploy). Self-contained commits gated by
   `bun run check`.
3. **Registry repo created**: `gh repo create nficano/skills --public`; copy the
   22 skills, flatten category dirs, **vendor the pakman resolver into
   youtube-dvr** so no `../<sibling>` import remains, rewrite relative framework
   imports to `elliott/*` subpath specifiers (audited: zero *new* exports
   needed), scrub the public surface (see §13 — includes moving the hardcoded
   `api.litellm.octet.stream` egress host out of the manifest into agent
   config), add CI, tag every skill at its manifest version. Moved multi-skill
   integration tests come here.
4. **Atomic elliott removal + tide-pods cutover** (the collision-safe step). In
   elliott: delete the 22 migrated skill dirs, prune `BUNDLED_CATALOG` + tests +
   `spec.components` + evolution-targets, regenerate topology; land as a commit
   `R`. In tide-pods, **in one change**: bump the elliott pin to `R` (so the
   bundled copies are already gone — no collision window), add the `install:`
   block, rename `telemetry_map` → `deep_trace` config key, add
   `.elliott/skills/` to `.gitignore`, add the Dockerfile
   `elliott skills install --frozen` build step, and commit the generated
   `skills.lock.json`. Because tide-pods only sees elliott changes when it bumps
   the pin, "old elliott meets new config" never occurs.
5. **Deploy + verify**: build the oslo image (frozen install bakes the cache),
   deploy to spruce, verify the `/healthz` install section is all-ok, the
   resolved gateway set is non-empty, Slack round-trips, and the deep-trace map
   publishes (new router, legacy router released by the §10 migration).

Ordering invariant: elliott-side removal (step 4a) and the tide-pods pin bump
that adopts it (step 4b) are bound by the SHA pin, so they are effectively
atomic from oslo's perspective; the registry (step 3) must exist and be tagged
before step 4b, and production is never asked to fetch at runtime.

## 13. Security model

- Installing a skill is installing code that runs in-process with the runtime's
  authority. The trust anchor is "the operator owns the registry and reviews
  every tag; no third-party PR is auto-tagged." The committed digest lock makes
  post-review tampering (moved tags, poisoned cache) detectable and, at build
  time, fatal. It does **not** make the initial install trustworthy — that is
  the operator's review of the registry repo (the one unavoidable TOFU moment).
- `register()` is ungoverned full-authority code, so the `SkillContext` it
  receives is scoped (§6): no control-plane/kill-switch secret, no global secret
  bag — only the skill's declared `secret://` grants and its own config block.
- Fetch/extract: system `tar` (correct pax handling), extraction into a temp dir
  whitelisting only the skill subtree, rejection of path-escape/absolute/link
  entries and nested `package.json`, hard caps on compressed and decompressed
  size, atomic same-filesystem rename into the cache.
- Trust anchoring: the committed lock digest is verified against fetched bytes on
  every fetch, and in production the cache is a **read-only image layer**, so a
  runtime writer (a rogue evolution proposal, a compromised evaluator companion)
  cannot poison it — the self-evolution write boundary is additionally barred
  from `.elliott/skills` and `skills.lock.json`, and installed-skill directories
  are declared out of scope for evolution mutation (frozen by construction).
- Unpinned "latest" cannot silently float in production: production never
  refreshes; a version bump requires a human-run `elliott skills lock`/refresh
  that shows the change and commits a new lock.
- Public-repo exposure: the scrub covers *functional* files, not just docs —
  environment-specific egress hosts (e.g. `api.litellm.octet.stream` in
  `subscription-usage`'s `egress.hosts`) move to agent config; the published
  manifests still reveal the `secret://` namespace and which SaaS/LAN services
  exist (an accepted residual for a personal registry — values never leak, and
  the vault paths are indirection only).
- `github_token` (optional, rate-limit only) comes from `config/secrets.yaml`;
  its silent omission on a Vault hiccup drops to 60/hr, which only matters on the
  refresh path — production's frozen build doesn't depend on it, so a
  crash-looping container can't pin itself at the rate limit (the v1 self-heal
  claim is now actually true because production never fetches at boot).

## 14. What the adversarial review changed (v1 → v2)

Load-bearing corrections (each independently broke v1):

1. **Read-only production container.** oslo runs `read_only: true` (writable:
   tmpfs `/app/data` + the `elliott-runtime` volume only). v1's runtime
   cache/lock writes to `<agentRoot>` were impossible → every boot re-fetched all
   skills; GitHub down on any restart = zero gateways. → **Build-time frozen
   install; committed lock authoritative; boot-time refresh only where writable.**
2. **Cutover collision.** v1 kept bundled skills as a "fallback" while adding
   same-named installed skills → guaranteed `metadata.name` collision → non-boot.
   → **Removal and pin-bump bound atomically by the SHA pin; no collision window.**
3. **GitHub tarballs are pax, not ustar** (verified against live codeload); the
   `matching-refs` endpoint returns everything in one response with no `Link`
   pagination (verified); the tarball root-dir name isn't computable
   (`skills-traefik-v1.0.0`). → **System `tar`; consume the full refs array; read
   the root prefix from the archive.**
4. **`register()` gets the whole secret bag including the kill-switch token**,
   ungoverned, at import time. → **Scoped `SkillContext`; control-plane secrets
   redacted from every skill.**
5. **Digest lock wasn't a pin.** v1 unpinned-latest floated on every boot and the
   lock just ratified it; the committed digest never gated a cold-cache fetch. →
   **Lock is authoritative; bytes verified against digest on every fetch; float
   only on explicit refresh.**

Additional fixes folded in: youtube-dvr→pakman relative import (vendor the
resolver); scheduler's false soft-degrade (make `#deliver` genuinely soft);
degraded-boot-reports-healthy (`required` markers + healthz gate + non-empty
gateway assertion in deploy); unknown-skill-name taxonomy inversion (fatal, not
silent); evolution-targets dangling on the three moved prompt skills;
telemetry-map rename stragglers (`index.ts:165` gateway literal, persisted
grant/route migration, both config files, dist string correction); the darwin
rename's stranded evolution stack (compose split + companion rebuild step);
decompression bounds; registry-field-change downgrade lever (advisory now);
`.elliott/skills` gitignore in both repos; `loadPackage` needs exporting; and the
full (previously undercounted) list of tests/catalog entries touched by removal.

Verified-sound-as-designed (attacked, held): module resolution of `elliott/*`
from the cache dir in both dev self-reference and tide-pods walk-up; the
two-pass facility loader with installed providers feeding built-in deep-trace;
governance decorating installed tools identically; the migration needing zero
new subpath exports; snapshot churn being benign; the app.ts:132 install slot
being correct.

## 15. Implementation status (2026-07-29)

Landed on branches (NOT merged to main — both elliott and tide-pods auto-deploy
on push to main, so the cutover is left for a reviewed, deliberate deploy):

- **elliott `skills-registry`** (pushed): the installer subsystem (`src/install/`
  — settings, resolver, system-`tar` fetch/extract, cache/lock, CLI, scoped
  `SkillContext`, soft delivery, `/healthz` install section), the deep-trace and
  darwin renames, and the removal of the 22 migrated skills. elliott now ships
  only the 8 built-ins (`fetch`, `evaluator/*`, `files`, `mcp-client`,
  `scheduler`, `ssh`, `terminal`, `deep-trace`). Gates green: typecheck, lint,
  format, 408 tests, `darwin:check`. contract-smoke counts recomputed
  (tools 41→9, gateways 4→1, routes 41→35, services 6→2, facilities 3→0).
- **`nficano/skills`** (public, live): 22 skills, per-skill tags
  `<name>/v<x.y.z>` (gateway-slack at v2.0.0, rest v1.0.0), README, CI, vendored
  schema. Verified end-to-end: unpinned `traefik` resolves to latest and pinned
  `gateway-slack@2.0.0` resolves exactly, both fetched as real codeload pax
  tarballs, extracted, validated, digest-locked.
- **tide-pods `skills-registry-cutover`** (pushed): elliott pin → the
  post-removal commit (+ surgical `bun.lock` SHA bump; git deps are
  content-addressed), `install:` block with oslo's 19 registry skills, committed
  `skills.lock.json`, `skills.telemetry_map`→`skills.deep_trace`,
  `.elliott/skills/` gitignored, and the Dockerfile frozen-install build step.
  `elliott skills install --frozen` against the committed lock materialized all
  19 with matching digests.

Open follow-ups (deploy-time, not code):

1. **Merge + deploy** both branches deliberately (production auto-deploys on
   main). The frozen build step needs network at image build; the read-only
   runtime never fetches.
2. **deep-trace persisted grant.** The legacy `elliott-telemetry-map-public`
   Traefik router/grant on spruce's `elliott-runtime` volume needs one manual
   release — the facility API can't cross-consumer-release (documented in
   `skills/deep-trace/src/publish.ts`, search "deep-trace-rename").
3. **darwin evolution stack.** Rebuild + redeploy the darwin images (new
   `ELLIOTT_DARWIN_*` env, rebuilt OCI digests) and split the evolution compose
   off the retired `elliott` runtime service before deploying — otherwise
   self-evolution acceptance fails against the recomputed source lock. Do not
   run the old `deploy-spruce.sh` `elliott` service (port/volume conflict with
   oslo).
4. **subscription-usage egress** carries `${LITELLM_HOST}` as declarative
   metadata only; the effective host is config-driven
   (`subscription_usage.litellm.base_url`), so nothing breaks — the scrub is
   cosmetic.
5. **registry CI** typecheck job needs the `ELLIOTT_DEPLOY_KEY` repo secret
   (private elliott dep); it is already gated to skip when absent (fork-safe).
6. **Curated topology** (`docs/elliott-topology.enriched.json`, served at
   `/topology`) still lists the moved skills and the `evaluator.companions`
   node id — cosmetic, ungated; the generated topology was regenerated.
