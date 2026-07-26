# Elliott Wiring Map — Enhanced 3D Design & Cinematic Plan

> Successor design to the current isometric map (`skills/telemetry-map/src/ui.html`).
> This document plans a **fully volumetric** scene — real altitude, force‑spaced
> domains, routed/arced edges, throughput‑driven sizing, focus/replay interaction,
> and a scripted **cinematic flythrough** ("the 3D video"). It also defines the
> **rich node/edge JSON schema** that carries the enhanced layout, from which we
> then derive the **pure connection graph** (`docs/elliott-topology.json`).

**Pipeline this document sits in**

1. **Plan** the enhanced 3D scene (this file) + the *rich* schema.
2. **Assemble** everything into `docs/telemetry-map-3d-topology.json` (connections **plus** all 3D/visual fields).
3. **Strip** every UI/UX/visual/feature/color field → `docs/elliott-topology.json` (just the connections).
4. **Verify** the stripped graph against source (separate agent).
5. **Enrich** with domains, classifications, contracts, routing, characteristics (separate agent).
6. **Re‑verify** the enriched graph (separate agent) → final output.

---

## 1. What the current map does (baseline)

The existing map (`ui.html`, 578 lines, hand‑rolled canvas) is already *pseudo‑3D*:

- **Projection** — isometric with orbit: `proj()` rotates by `cam.az`, projects on a
  `.866` iso axis, applies `depthK(tilt)`/`heightK(tilt)`; depth‑sorts per frame.
- **Layout** — one flat **board** per layer (`BOARD` table, hand‑placed `x,z`); nodes
  gridded onto each board via `√(count·aspect)`. **Everything sits at `y≈0`.**
- **Nodes** — extruded **prisms** (`prism()`) or **cylinders** (`cylinder()` for
  `database`/`container`). Uniform footprint `1.35`; height by kind only (`0.5–0.8`).
- **Edges** — straight 2D segments between node mid‑heights, colored by `kind`
  (`EDGE_COLOR`); `sqlite` wires dashed. Live **particles** animate along them.
- **Interaction** — orbit (drag/shift‑drag/Q/E), tilt (scroll), zoom (pinch/dblclick),
  pan with momentum, click→drawer, hover→tooltip, live SSE glow.

**Ceiling of the baseline.** The third dimension is decorative — altitude is unused,
so domains read as a flat floorplan; node size is meaningless; edges are a
straight‑line hairball with no routing, direction, or contract; and there is no way
to focus, filter, or *replay* a turn. The enhancements below spend the Y axis, the
size channel, and the edge geometry on real information.

---

## 2. Spacing — a volumetric, dataflow‑shaped layout

Replace the flat per‑layer boards with a **stratified radial arena**.

### 2.1 Altitude encodes architectural tier (spend the Y axis)

Each domain is lifted to a **tier band** (`y`), so height means something:

| Band | `y` | Domains | Rationale |
| :--- | :--- | :--- | :--- |
| **T0 substrate** | 0.0 | containers, secrets | the ground everything runs on |
| **T1 ingress** | 1.0 | gateways, MCP endpoints | the outer skin (how the world reaches in) |
| **T2 core** | 2.2 | runtime (loop, prompt, router, model client, tool exec, http, kernel) | the elevated central keep where turns execute |
| **T3 sinks** | 1.4 | memory/database, tools | where the core reaches down to act & persist |
| **T4 providers** | 2.6 | model providers | lifted out to the horizon; the core "calls up" to them |
| **T5 reflective** | 3.0 | learning/evolution, observability | the canopy that watches the core from above |

The primary request path becomes a readable **arc**: it enters low at the perimeter
(T1), climbs into the core (T2), reaches out/up to providers (T4) and down to
sinks (T3), while learning/observability hang above (T5) watching. Feedback/learn
edges visibly *loop back down* from the canopy into the core.

### 2.2 Domain islands on a radial ground plan

- The **runtime core** sits at the origin — the gravitational center every turn flows
  through. All other domains are placed on a **hex/radial ring** around it, angle
  chosen to minimize crossing of the highest‑traffic edges (gateways feed in from
  one arc; providers on the opposite arc so the model call reads as a clean span
  across the core; memory/tools below; learning/observability above‑behind).
- Within an island, nodes are placed by a **force layout** (spring on edges,
  charge repulsion, gentle grid snap) so dense domains (runtime, learning) don't
  overlap and edge length is minimized. Islands are separated by clear gutters.

### 2.3 Spacing rules

- Minimum node separation `≥ 2.4·footprint`; island gutter `≥ 3` world units.
- Nodes with high **degree** (fan‑out) are pulled toward their island's edge‑facing
  side so their many edges splay outward instead of crossing the island.
- The core keep is oversized and centered; camera **home** frames the core with the
  gateway→core→provider arc spanning the view.

---

## 3. Sizing — encode role and live throughput

Size is a data channel, not a constant.

- **Footprint = fan‑out (degree).** A node's base radius scales with its number of
  connections, so hubs (agent loop, tool exec, session store) read as larger.
- **Height = persistence/criticality tier.** Databases & containers are tall
  cylinders (durable substrate); the **agent loop** is the tallest core keep;
  ephemeral helpers are low tiles.
- **Live scale = throughput.** A node breathes with rolling activity:
  `scale = base · (1 + k·log₁₊(rate))`, where `rate` is that node's recent event
  volume — turns through the loop, tool fires at tool exec, rows/s at the DB,
  tokens/s at the model client. Idle nodes settle to a quiet baseline; a burst
  scales up then eases back (spring). This makes "where the work is" legible at a
  glance and turns the map into an activity meter.
- **Emissive intensity = heat.** Recently‑active nodes glow brighter; the glow
  decays (`glow *= 0.93/frame`, as today) so the eye tracks the live front.

---

## 4. Edge representation — routed, typed, directional, bundled

The single biggest upgrade. Edges stop being straight lines.

### 4.1 Routed 3D arcs (no more ground hairball)

Each edge is a **quadratic/cubic Bézier tube** whose control point lifts off the
plane by an amount `∝ endpoint distance` (long edges bow high overhead; short
edges stay low). Tubes route *over* the scene, so they no longer stab through
intervening nodes. Endpoints dock at the node's rim at the correct tier height.

### 4.2 Type → geometry (read the connection kind without a legend)

| `kind` | Geometry | Meaning |
| :--- | :--- | :--- |
| `data` | solid round tube, flowing | payload/message transfer |
| `control` | thin tube, short dashes | orchestration / dispatch |
| `persist` | tapered pipe **descending** into a DB/container cylinder | durable write |
| `learn` | curved **dashed loop**, low opacity, arcs back down from T5 | evolution feedback |
| `health` | faint hairline | liveness / polling |
| `secret` | dotted, muted, no flow particles | config/secret reference (never a value) |

### 4.3 Direction & throughput (animated flow)

- A **flow gradient / particle train** runs along the tube in the edge's direction;
  **particle rate = live throughput** on that edge, **particle color = payload class**
  (from enrichment). At rest the tube is quiet; under load it streams.
- **Bidirectional** connections (model client ⇄ provider; core ⇄ postgres) render as
  **two offset lanes** — a request lane and a response lane — so req/resp is visible.

### 4.4 Bundling (tame the cross‑domain tangle)

Parallel edges between the same two islands are **bundled** into a shared trunk that
splays into individual strands only near the endpoints (hierarchical edge bundling).
E.g. the six `tool exec → tool.*` edges braid into one core→tools trunk that fans
out over the tools island.

### 4.5 Edge affordances

- **Hover an edge** → a mid‑tube label shows `label · protocol · payload`
  (contract fields come from enrichment) and the **evidence** (`file:line`).
- Edges inherit **focus dimming** (§5.1): unrelated edges drop to ~8% opacity.

---

## 5. Interaction — focus, filter, and replay

### 5.1 Focus / isolate

Click a node → camera **dollies** to frame it; its **1‑hop neighborhood** stays lit
while everything else fades (nodes ~15%, edges ~8%). The drawer shows identity +
typed connection list. `Esc` or empty‑click restores the wide view. Double‑click a
domain island → frame just that island.

### 5.2 Trace / replay a turn ("scrub the flow")

A **timeline scrubber** binds to a real recorded turn (`runId`). Dragging it replays
that turn's event sequence in order — `inbound → turn.begin → model.request →
model.selection → tool.progress… → db.write → turn.finish` — lighting each hop as it
happened, with elapsed time. This is the interactive twin of the cinematic mode.

### 5.3 Filter & solo

Toggle chips for **domain**, **node kind**, and **edge kind**. Soloing a domain dims
the rest; filtering by edge kind (e.g. only `persist`) isolates one concern. A
"primary path only" toggle hides `health`/`secret`/`learn` to show just the hot loop.

### 5.4 Camera, depth cues, level‑of‑detail

- **Cinematic auto‑orbit** idle mode; **follow‑flow** mode flies the camera along the
  live dataflow.
- **Atmospheric perspective** (subtle fog), **contact shadows**, and **depth‑of‑field**
  on focus give real depth; a faint ground reflection anchors the arena.
- **LOD**: distant islands collapse to a single labeled glyph + count; zooming in
  expands them. Labels declutter by zoom & focus (as today, extended to edges).

---

## 6. The cinematic "3D video" (scripted flythrough)

A ~45–60s scripted camera path + timed reveal that narrates one question end‑to‑end.
Beats (each is a camera keyframe + a scene trigger):

1. **Establish** — wide slow orbit of the whole arena; everything dim and idle.
2. **Ingress** — a message lands; camera swoops to the **gateways** island (T1); the
   inbound edge lights and a packet flies into the core.
3. **Core wake** — camera rises into the **runtime keep** (T2); `#handleInbound`→loop
   pulses; the agent‑loop keep scales up.
4. **Prompt** — prompt‑assembly node glows; camera pushes in as the system+messages
   assemble.
5. **The call** — the **request lane** to the **provider** (T4) ignites across the
   arena; camera tracks the packet up to LiteLLM and the **response lane** back.
6. **Route attest** — a brief glow on the route‑attestation node (the digest).
7. **Act** — tool‑exec trunk fans out to the **tools/MCP** islands; parallel tool
   fires strobe; camera pulls to frame the fan‑out.
8. **Persist** — `persist` pipes cascade **down** into the **sessions.sqlite** cylinder
   (T3); rows tick up; camera drops to ground to watch the DB fill.
9. **Learn** — feedback/evolution edges loop up into the **learning canopy** (T5) and
   back down; a soft pulse across signals→triage→gauntlet→proposals.
10. **Pull back** — camera retreats to the establishing wide shot; turn.finish; the
    arena settles to idle glow.

Implementation: a keyframe list `[{t, camPose, trigger}]` driven by the same
`handleEvent()` pipeline, either **live** (bind to the next real turn) or **replayed**
from a recorded `runId`. Export path: capture canvas frames → WebM (optional).

---

## 7. Rich node/edge JSON schema (what "put it all together" produces)

`docs/telemetry-map-3d-topology.json` carries the **connection core** *and* every
**visual/3D field** the scene needs. The visual fields (everything under `render`,
plus `tier`, `island`, `size`, `route`, `lane`, `flow`, `bundle`, colors) are exactly
what step 3 **strips** to yield `docs/elliott-topology.json`.

```jsonc
{
  "version": "2.0.0",
  "kind": "rich-3d-topology",           // stripped away
  "nodes": [
    {
      // ---- connection core (KEPT after strip) ----
      "id": "runtime.agentLoop",
      "name": "RuntimeAgent.turn",       // functional identity (not a display title)
      "kind": "agent-loop",
      "source": "src/runtime/agent.ts:43",
      // ---- visual / 3D (STRIPPED) ----
      "render": {
        "tier": "T2-core", "y": 2.2,
        "island": "runtime", "seed": {"x": 0, "z": 0},
        "shape": "keep", "sizeBy": ["degree", "throughput:turns"],
        "baseFootprint": 1.9, "baseHeight": 1.4,
        "color": "#79b98d", "emissiveOn": "turn.begin"
      }
    }
  ],
  "edges": [
    {
      // ---- connection core (KEPT after strip) ----
      "id": "e.prompt.model",
      "from": "runtime.prompt", "to": "runtime.modelClient",
      "kind": "data",
      "protocol": "in-process",          // becomes richer in enrichment
      "label": "ModelTurnRequest",
      "evidence": "src/runtime/agent.ts:65",
      // ---- visual / 3D (STRIPPED) ----
      "render": {
        "route": "bezier", "lift": 0.8, "style": "tube",
        "lane": "request", "flow": {"dir": "forward", "rateBy": "throughput"},
        "bundle": "runtime-internal", "color": "#4d7fb0", "animatable": true
      }
    }
  ]
}
```

**Strip rule (step 3).** Delete `kind: "rich-3d-topology"`, every node `render{…}`,
every edge `render{…}`, and any top‑level `layers`/`iso`/palette. Keep, per node:
`id, name, kind, source` (+ real data like `tables`, `models`, `transport`). Keep,
per edge: `id, from, to, kind, protocol, label, evidence` (+ `carries`). The result
is `docs/elliott-topology.json` — **just the connections** — ready for verify →
enrich → re‑verify.

---

## 8. Feasibility notes

- **Still library‑free & `egress:none`.** Bézier tubes, force layout, tier bands, and
  the cinematic keyframer are all hand‑rollable on the existing `<canvas>` 2.5D
  projector (`proj()`), or on a WebGL upgrade if desired later. No CDN, matching the
  extension's `egress: none` posture.
- **Same data feed.** Every enhancement is driven by the *existing* topology +
  `/state` + SSE stream; nothing new is required from core. Throughput sizing reads
  the same `db.write`/`tool.progress`/`model.*` events already emitted.
- **Backwards compatible.** The rich schema is a superset; a viewer that ignores
  `render{…}` degrades to the pure graph.
