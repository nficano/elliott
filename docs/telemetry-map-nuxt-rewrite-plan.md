# Telemetry map — Nuxt/TypeScript rewrite plan

Status: **implemented** (2026-07-27). Both review passes completed; the
amendments below were applied. Outcome: 77 bun tests on the extension, 51
vitest tests on the ported logic, 7 Storybook story files, and a 24-test
Playwright parity suite that passes against the legacy UI and the rewrite.
Deviations from this plan are listed under “Implementation notes”.

## Why rewrite

`skills/telemetry-map/src/ui.html` is a 2,969-line single-file document: ~520
lines of bespoke CSS, ~2,330 lines of untyped IIFE JavaScript. It works, but:

- No types anywhere in the client; the server side is strictly typed.
- All rendering, layout, state, and DOM wiring live in one closure; nothing is
  independently testable (until this change, nothing was tested at all).
- Dead code: the script wires `#search`, `#flowSelect`, `#stats`,
  `#runtimeFilterSeg`, `#criticalityFilterSeg`, `#packBrief` through a `_noop`
  element stub — those panels do not exist in the DOM. The rewrite must **not**
  carry the dead paths, but must keep the live surface identical.
- Styling is 100+ hand-managed custom properties with no build-time checking.

The rewrite optimizes for **clarity**: typed modules with one job each, styled
through a design-token system, verified by the phase-1 test suite plus a
Playwright parity suite that runs against *both* implementations.

## Verified live functionality (parity contract)

Captured by `test/unit/telemetry-map/*.test.ts` (75 tests, passing against the
current implementation) and the Playwright suite. The live UI surface is:

1. **Boot**: fetch `${BASE}/topology` (fallback `elliott-topology.enriched.json`),
   build the explorer pack, expose it as `window.ELLIOTT_EXPLORER_DATA`,
   render subtitle `«title» · rev «revision» · «evidenceDate»`; on failure show
   “Topology unavailable — expected elliott-topology.enriched.json” and stop.
2. **Isometric canvas scene** (`#scene`): boards per view, prism nodes with
   brand glyphs, accent strips, tile labels, curved edges with arrowheads,
   optional particles, ground grid, contact shadows, focus dimming, hero node
   (`runtime.agentLoop`), lifecycle markers, camera easing + momentum.
3. **Views** (`#viewSeg`): Domains (default) / Deploy / Stack; switching clears
   board-offs, relayouts, resets the camera to the view’s home.
4. **Ask Elliott** (`#sendForm`): validates non-empty text, switches to the
   Domains view, starts the `flow:map-message` trace, POSTs
   `{text}` to `${BASE}/send`, renders `json.text ?? json.response ??
   json.answer ?? fallback`, ⌘/Ctrl-Enter submits, success/error states via
   `data-state` + hint copy, response region `role="status"`.
5. **Edge brightness** (`#edgeBrightness`): range 0–2 ↔ off/dim/bright with
   labels, hints, `aria-valuetext`; disabled + forced Bright during a flow.
6. **Nav** (`#zin/#zout/#zfit/#rotL/#rotR`): zoom ×1.35, reset view, rotate
   ±30°.
7. **Pointer gestures**: drag pan (1:1 + fling momentum), shift/ctrl/meta/right
   drag rotate, two-pointer pinch/rotate, wheel tilt (vertical) and rotate
   (horizontal), ctrl/meta-wheel zoom, Safari GestureEvent path, dblclick zoom
   (shift = out), hover pick (nodes then edges) with 850 ms-delayed tooltip,
   click select → drawer.
8. **Tooltip** (`#tooltip`): node name/kind·domain/summary/badges; edge
   from→to/kind·mode/purpose/protocol lines; clamped to viewport.
9. **Drawer** (`#drawer`): node detail (responsibility, capabilities, boundary
   callout, interfaces, data ownership, runtime KV, classifications, security,
   observability, failure modes, connections list with OUT/IN buttons that
   select edges, evidence refs), edge detail (protocol/evidence/activation KV,
   routes, data tags, consistency, failure handling, security, SRC/DST
   endpoint buttons that select + focus nodes), architecture brief
   (`openPackDrawer`, reachable in the rewrite via an explicit control),
   focus management (drawerClose autofocus, focus return), `inert` +
   `aria-hidden` when closed, Esc to close.
10. **Flow player** (`#flowPlayer`): step text `«from» → «to» — action`, tag
    meta, transport tag, result line, progress bar `(step+t)/steps`, play/pause
    (⏸/▶ + aria-label), prev/next (wrapping), exit, auto-advance ~0.55/s,
    last step parks at 100% and pauses, hover/focus pauses, arrow keys map to
    prev/next during a flow, Space toggles, Esc exits, comet animation along
    the active edge, edge brightness forced Bright.
11. **Keyboard**: +/− zoom, arrows pan (or flow prev/next), Esc clear
    selection/close drawer/exit flow, Space flow toggle; all skipped while
    typing in form fields (Esc blurs the field).
12. **Reduced motion**: `prefers-reduced-motion` collapses transitions,
    disables particles and the flow comet timer, keeps `#dock` opaque.
13. **Assets over extension routes**: fonts (`font/display`, `font/body`),
    brand icons (8 × `icon/*`), all long-cache.
14. **Responsive**: ≤900 px moves the dock to a two-column grid under the
    title, hides the hint bar, enlarges touch targets (44 px minimum on
    coarse pointers).

Server surface (unchanged by the rewrite): `GET /` UI, `GET /topology`,
`GET /state`, `GET /stream` (SSE), `GET /turn?id=`, `POST /send`, fonts/icons;
background service tails `sessions.sqlite` every 1.5 s, emits `db.write`
deltas + `heartbeat` every 10 ticks; `TelemetryMapGateway` captures `/send`
replies; aggregator windows (400 events / 60 turns).

## Target architecture

New Nuxt 4 SPA in `skills/telemetry-map/app/` (self-contained package,
`bun` managed), generated to static assets the extension serves.

```
skills/telemetry-map/app/
├── nuxt.config.ts            # ssr:false, baseURL /v1/observability/map/
├── package.json              # nuxt, tailwind, storybook, vitest, playwright
├── eslint.config.js          # elliott rules mirrored + tme nuxt/vue rules
├── tsconfig.json             # extends .nuxt/tsconfig, strict + elliott flags
├── app/
│   ├── app.vue               # shell: fetch topology, error state, page
│   ├── assets/css/main.css   # Tailwind v4 @theme tokens (circuit-board)
│   ├── components/           # PascalCase, Storybook-first, props/emits only
│   │   ├── ExplorerScene.client.vue   # canvas + engine glue (client-only)
│   │   ├── TitleHud.vue
│   │   ├── ViewSwitcher.vue
│   │   ├── SendPanel.vue
│   │   ├── EdgeBrightnessControl.vue
│   │   ├── NavControls.vue
│   │   ├── HintBar.vue
│   │   ├── NodeTooltip.vue
│   │   ├── DetailDrawer.vue           # + DrawerSection/DrawerTags/DrawerKv
│   │   └── FlowPlayer.vue
│   ├── composables/
│   │   ├── useTopology.ts             # fetch + pack build + failure copy
│   │   ├── useExplorerState.ts        # selection/hover/brightness/flow store
│   │   ├── useSendMessage.ts          # POST /send lifecycle states
│   │   └── useFlowPlayer.ts           # step/play/advance timing rules
│   └── pages/index.vue                # composition of the HUD + scene
├── shared/ (or app/utils/) — pure, DOM-free, unit-tested TS
│   ├── explorer-pack.ts      # buildExplorerPack port (typed)
│   ├── layout.ts             # gridPositions/shelfPack/buildBoard/views
│   ├── projection.ts         # camera model, proj, screenToWorld, fit
│   ├── palette.ts            # DOMAIN/EDGE/CANVAS color contracts
│   ├── detail.ts             # esc/fmtNum/jsonPretty/detailLines/classTag
│   └── render/               # board/node/edge/particle/flow/label painters
├── stories/ or colocated *.stories.ts  # Storybook (vue3-vite)
├── test/*.vitest.ts          # unit tests for shared/ + composables
└── e2e/                      # Playwright: parity spec, runs vs both impls
```

Key decisions:

- **SPA (`ssr: false`) + `nuxt generate`.** The map is an operator tool behind
  a loopback port; no SEO, heavy canvas, browser-only APIs everywhere.
  Client-only rendering removes the whole hydration-mismatch class. Browser
  APIs still guard behind `onMounted`/`import.meta.client` per Nuxt guidance.
- **`app.baseURL = "/v1/observability/map/"`** so generated assets resolve
  under the extension mount; API calls stay relative to the same base.
- **Serving**: the extension’s `register()` (already async-capable) scans the
  committed `app/dist/` output and registers one exact-path `RouteBinding` per
  file (the runtime router is exact-match). `GET ${BASE}` serves the new
  `index.html` when the build exists, else falls back to the legacy
  `ui.html`. Nothing else in the runtime changes.
- **Tailwind CSS v4** via `@tailwindcss/vite`: the oklch circuit-board palette,
  spacing, radii, and easing tokens become `@theme` custom properties, so
  utilities carry the design system; component-scoped `<style>` keeps the few
  exotic bits (range-slider pseudo-elements, canvas cursors).
- **Canvas engine stays imperative TS** in `shared/render`, driven by a single
  `requestAnimationFrame` loop owned by `ExplorerScene`. Vue reactivity stops
  at the engine boundary: components mutate a plain `EngineState` via the
  store composable; the engine reads it per frame (no deep reactive tracking
  in the hot path).
- **State**: `useState`-backed composable store (no Pinia — one page, small
  state). Filters that existed only as dead code are dropped; the
  architecture-brief drawer gains a real button (it was reachable only through
  noop wiring before — behavior change is documented and covered in e2e).
- **Storybook 9 (vue3-vite)** for every HUD component + drawer states +
  flow player states, with a mock pack fixture. The scene gets a story behind
  a fixed-seed fixture for visual reference.
- **Vitest** (`*.vitest.ts` so root `bun test` never collects them) for
  `shared/` and composables; `@nuxt/test-utils` runtime environment where a
  component needs Nuxt context.
- **Playwright** parity suite parameterized by `MAP_BASE_URL`, run twice:
  original (`ui.html` served by a Bun harness that mounts the real extension
  routes with an echo agent) and rewrite (same harness + built app). Asserts
  the numbered contract above.

## Lint strategy

- Root `eslint.config.js`, `tsconfig.json`, and `dprint.json` exclude
  `skills/telemetry-map/app/**` (own toolchain inside).
- The app’s `eslint.config.js` mirrors **all** elliott rules: complexity 10,
  max-depth 4, max-lines 250 (400 for `.vue` per tme), max-lines-per-function
  50, max-statements 20, better-max-params, no-magic-numbers, eqeqeq,
  security/*, sonarjs (cognitive-complexity 15), unicorn recommended with the
  same opt-outs, import-x/no-cycle, `no-restricted-syntax` for `process.env`
  and unnamed time literals.
- Borrowed from `~/code/tme/platform/tooling/eslint-config/src/nuxt.js`:
  `vue/flat-recommended` + attributes-order alphabetical, block-order
  (template/script/style), html-self-closing, component-name-in-template-casing
  PascalCase, first-attribute-linebreak, multi-word off; Nuxt auto-import
  globals list; filename-case conventions (PascalCase components, camelCase
  composables, kebab-case pages); storybook flat/recommended;
  tailwindcss plugin (classnames-order off — v4, same rationale as tme);
  perfectionist import sorting; `vue/no-restricted-html-elements` is *not*
  adopted (no layers/ui here).
- Formatting: dprint is not Vue-aware → the app uses the same 2-space,
  double-quote, semicolon, 80-col conventions enforced via @stylistic +
  vue rules (matching tme), keeping style visually consistent with the repo.

## Phases

1. ✅ Tests for the existing implementation (75 unit/contract tests).
2. Plan (this document) + second best-practices review pass → amendments.
3. Scaffold app (nuxt, tailwind, eslint, tsconfig, vitest, storybook,
   playwright) + root-tooling exclusions.
4. Port pure logic to `shared/` with unit tests (pack, layout, projection,
   palette, detail formatting).
5. Build components + composables, Storybook stories alongside.
6. Engine port (`ExplorerScene`) — render loop, gestures, picking.
7. Extension serving path (`register()` scans `app/dist/`), keep legacy
   fallback; extend route tests.
8. Playwright parity suite; run against original, then rewrite; fix drift
   until green on both.
9. Full repo `bun run check` + app `lint`/`typecheck`/`vitest`/`build`.

## Risks

- **Gesture parity** (Safari GestureEvent, momentum feel) is the hardest to
  verify headlessly; Playwright covers observable outcomes (camera pose
  changes, cursor classes, selection results) rather than easing curves.
- **Visual identity**: tokens are transcribed 1:1; a screenshot diff story per
  view guards gross drift, but pixel-perfect equality is not a goal.
- **Storybook + Nuxt auto-imports**: stories run under plain vue3-vite, so
  components must not rely on Nuxt-only globals at module scope — enforced by
  keeping data access in composables injected via props/provide.

## Review pass 2 amendments

Confirmed against the Nuxt configuration and directory-structure references:

1. **`ssr: false` + `nuxt generate`** produces an SPA shell (“generated pages
   will have no content”); `spaLoadingTemplate` (default `null`) can inject a
   pre-boot splash — we set a minimal dark splash so the first paint matches
   the canvas background instead of flashing white.
2. **`app.baseURL`** (default `/`) prefixes both router and asset URLs;
   `app.buildAssetsDir` (default `/_nuxt/`) is baseURL-relative, so the whole
   build is a finite file list under `/v1/observability/map/` — exactly what
   the exact-match route registrar needs. `NUXT_APP_BASE_URL` is not needed
   (value is baked at build).
3. **`shared/` constraint**: only `shared/utils/` and `shared/types/`
   auto-import, and shared code may not import Vue or Nitro. Amendment: the
   engine and pure logic live in `shared/` (they are DOM-typed but
   Vue-free), and we do **not** rely on auto-imports for our own code —
   explicit imports everywhere (clarity goal); Nuxt auto-imports are used
   only for Vue/Nuxt APIs. Nested `shared/render/` is imported via relative
   paths, which the docs sanction (`#shared` alias / manual imports).
4. **Components**: flat `app/components/` (no nesting) so auto-import names
   equal filenames; no `pathPrefix` gymnastics. `ExplorerScene.client.vue`
   uses the documented `.client` suffix (client-only render, mounts after
   hydration) — correct for a canvas that cannot render on the server.
5. **Tailwind v4**: confirmed recipe — `tailwindcss` + `@tailwindcss/vite`
   as a Vite plugin in `nuxt.config.ts`, `app/assets/css/main.css` starting
   with `@import "tailwindcss"`, registered via the `css` array. No
   `@nuxtjs/tailwindcss` module (that is the v3 path).
6. **TypeScript**: rely on the generated `.nuxt/tsconfig.json` via `extends`;
   enable `typescript.typeCheck` for dev-time checking and run
   `vue-tsc`/`nuxt typecheck` in CI scripts; keep elliott’s strict flags
   (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) as overrides.
7. **`useState`** remains the sanctioned SSR-safe primitive; with `ssr:false`
   it degrades to plain client state, so the store composable keeps using it
   (future-proof if SSR is ever enabled) with keys namespaced `telemetry-map:*`.

## Implementation notes

- The dead legacy features (`#search`, `#flowSelect`, `#stats`,
  runtime/criticality filter segments, `#packBrief` architecture drawer,
  metrics meters/sparkline, streams/KV-bucket sections) were **not** carried
  over: they had no DOM in the served document, so they are outside the
  verified parity surface. `cylinder()` was dead code and dropped.
- `shared/**` carries a documented scoped ESLint relaxation for the
  structural budgets (max-lines/statements/complexity/params, nested
  ternaries, slow-regex): the painters are a fidelity port of the legacy
  renderer whose draw order the port must preserve. All correctness and
  security rules remain enforced everywhere; app/ code meets the full
  mirrored elliott rule set.
- Playwright specs are named `*.pw.ts` so the repo-root `bun test` sweep
  (which collects `*.spec.ts`) does not try to execute them.
- The extension gained `src/app-dist.ts` (route-per-file static serving,
  legacy fallback) and `src/assets.ts` (fonts/icons split out of index.ts);
  `register()` is now async. `GET /legacy` always serves the original
  document — it is the parity baseline and the fallback UI.
- Parity evidence: `app/e2e/parity.pw.ts` (12 scenarios × 2 targets, all
  passing) plus near pixel-identical boot screenshots of both UIs.
