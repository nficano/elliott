# Flow Stack Explorer — implementation notes

Reference inspected:

- Source: `flow/docs/architecture/flow-stack-explorer/index.html`
- Data: `flow/docs/architecture/flow-stack-explorer/data.js`
- Runtime reference: `http://127.0.0.1:18083/index.html`
- Target: `elliott/skills/telemetry-map/src/ui.html`
- Target data: `elliott/docs/elliott-topology.enriched.json`

## Product shape

This is a full-viewport spatial workbench, not a dashboard grid. The topology
canvas is the product. UI chrome is fixed to viewport edges and intentionally
small so the map remains primary.

The shipped Elliott composition has four persistent regions:

1. Wordmark and evidence subtitle at top-left.
2. View and Ask Elliott dock at top-right.
3. Camera controls at bottom-right.
4. A centered gesture hint along the bottom edge.

Two contextual regions appear above that chrome:

- A left detail drawer for architecture, node, or edge details.
- A bottom-center narrated-flow player.

## Visual system

### Palette

- Canvas: warm moonlight paper, built from a warm radial wash over a cream
  diagonal gradient.
- Primary ink: `#2b2b2b`.
- Secondary ink: `#66645e`.
- Signal accent: muted teal `#3f7b7e`.
- Panels: translucent cream at roughly 82–90% opacity.
- Borders: warm gray at roughly 45% opacity.
- Domain color is applied to slabs, nodes, small swatches, and focused labels.
- Edge color is semantic and independent of the connected domains.
- Danger, warning, and success are low-area washes used only inside tags or
  control state feedback.

### Type

- Display: Generation 1970 Light, used for the wordmark and drawer titles.
- UI/body: Inter Variable.
- Code/IDs: SF Mono / platform monospace.
- Wordmark is approximately 21 px at weight 300.
- Body chrome is deliberately compact: 9–13 px.
- Section labels use uppercase, 800 weight, and approximately `.09em` tracking.
- Numeric counters use tabular-looking compact figures with uppercase labels.

### Surfaces

- Panels use warm translucent fills, 1 px warm borders, 10–16 px radii, and a
  restrained three-part soft shadow.
- Active segmented items become opaque white with the stronger inset shadow.
- The top-right dock rests at 20% opacity and fades to full opacity on hover or
  keyboard focus.
- Drawer and tooltips use stronger elevation than persistent controls.

## Canvas geometry

### Projection

- Canvas 2D, device-pixel-ratio capped at 2.
- Isometric projection rotates world X/Z around azimuth, then projects:
  - horizontal: `(rotatedX - rotatedZ) * 0.866`
  - vertical: `(rotatedX + rotatedZ) * tiltDepth - worldY * heightScale`
- Camera state has current and target values for azimuth, tilt, zoom, and pan.
- Non-drag camera changes ease toward their target; direct dragging remains 1:1.

### Boards

- Each board is a low isometric slab with:
  - tinted top face;
  - darker front/right faces;
  - dashed perimeter and cluster boundaries;
  - a large flat-on-deck title;
  - a component count in the title;
  - soft contact shadow beneath the slab.
- Nodes use one evenly spaced grid inside each board.
- Domains view creates one board per domain.
- Deploy view creates one board per trust zone.
- Stack view creates eight equally sized, x/z-aligned platforms separated only
  by altitude.

### Nodes

- Runtime components use one shallow rectangular-prism footprint; database-like
  nodes—including SQLite and the declared Postgres container—use the same
  layout footprint but render as low cylinders with two storage rings.
- Graph degree does not change node size.
- Height is intentionally restrained; board identity is more important than
  exaggerated skyscraper height.
- Nodes receive soft contact shadows.
- Selection adds a dashed teal ground outline.
- Focused nodes show a compact floating label.

### Edge arches

- Every edge is a quadratic Bézier arch.
- Start/end anchor at the node roof.
- Control point is centered horizontally and lifted by:
  - a fixed base lift;
  - an additional lift proportional to 3D distance.
- Semantic styles:
  - data: blue, solid;
  - control: teal, dashed;
  - persist: green, solid and slightly heavier;
  - learn: amber, dashed;
  - health: gray, dashed and light;
  - secret: violet, dashed.
- Default alpha is low enough to preserve the boards.
- Hover, selection, and flow focus increase alpha and width.
- Non-neighbor edges dim aggressively when a node or edge is focused.
- Arrowheads appear near the destination when hot or sufficiently zoomed.
- Hot edges show a label pill at the arch apex.

### Edge traffic

- Small particles travel along the same quadratic path.
- Edge kind maps to a qualitative particle count, speed, and radius.
- The particle grammar conveys connection character only; it does not claim measured traffic.
- Edge kind controls particle color.
- Particles are removed below a zoom threshold.
- Reduced-motion mode disables ambient edge particles.

## Camera interaction

- Drag: direct pan.
- Release after a fast drag: bounded fling momentum with exponential friction.
- Shift-, Control-, Command-, or right-drag: rotate.
- Two pointers: simultaneous pinch zoom, twist rotation, and midpoint pan.
- Trackpad:
  - pinch / control-wheel: zoom, anchored at pointer;
  - horizontal two-finger scroll: rotate;
  - vertical two-finger scroll: tilt.
- Safari gesture events explicitly separate pinch and twist.
- Double-click: 2.2× zoom at pointer.
- Shift-double-click: zoom out.
- Rotation has no keyboard shortcut; it requires the visible rotate controls,
  modified pointer drag, twist, or trackpad gesture.
- Plus / minus: zoom.
- Arrow keys: pan, or step through an active flow.
- Escape: clear drawer/selection, or exit the active flow.
- Space: pause/resume active flow.
- Reset: restores view azimuth/tilt and fits visible boards.

## Persistent controls

### Top-right dock

Two stacked cards:

1. View segmented control: Domains / Deploy / Stack.
2. Ask Elliott message textarea, Send + trace action, helper/error state, and
   inline captured response.

The cards remain visually subordinate until pointer hover or focus-within.

### Ask Elliott

- Empty submit retains focus, sets `aria-invalid`, and uses the reserved helper
  slot for “Write a message before sending.”
- Send and Command/Control+Enter both submit to
  `POST /v1/observability/map/send`.
- While the request runs, the input and action are natively disabled and the
  helper text reports progress.
- Submission switches to Domains and immediately opens the ten-step
  `Map message → Elliott` trace.
- The captured Elliott reply renders in an `aria-live` status region.
- Success keeps the highlighted path available; errors retain the message so
  the operator can retry.

## Hover and selection

### Node hover

- Immediate cursor change and neighbor focus.
- Tooltip appears after 850 ms.
- Tooltip contains name, kind/domain, concise responsibility, and up to three
  metadata badges.

### Edge hover

- Uses the same 850 ms delay.
- Tooltip contains exact direction, kind, purpose, protocol, consistency, and
  failure behavior.

### Node selection

- Keeps the node and directly connected neighbors fully opaque.
- Dims unrelated geometry and edges.
- Opens the node drawer.

### Edge selection

- Keeps only source and destination in the focus set.
- Raises edge width/alpha and shows its arrowhead/apex label.
- Opens the edge drawer.

## Detail drawer

- Fixed left sheet, 352 px desktop width.
- 16 px viewport inset and rounded card shell.
- Slide-in uses transform only.
- Background stays visible and becomes contextually dim through canvas focus.
- Header contains:
  - semantic color swatch;
  - uppercase type/domain or edge kind/direction;
  - Generation 1970 title;
  - monospace stable ID;
  - compact close control.
- Body is independently scrollable.

### Node content

- Verified responsibility.
- Capability/runtime/criticality tags.
- Boundary rationale and factual characteristics.
- Interface contract.
- Runtime state, trust authority, and criticality.
- Data classifications.
- Scaling, security, operability, and failure modes.
- Incoming and outgoing verified connections.
- Repo evidence paths.

### Edge content

- Exact source → destination.
- Purpose.
- Verified protocol, activation, routing, and evidence; no traffic measurements are fabricated.
- Protocol.
- Routing/subject.
- Data on the wire.
- Delivery, ordering, and idempotency notes.
- Failure handling and security.
- Clickable source and destination rows.

## Narrated flow player

- Sending a message clears node/edge selection and opens a bottom-center card.
- All nodes involved in any step remain in the focus set.
- Each step renders:
  - flow name;
  - `STEP n/total`;
  - source → destination;
  - verified edge action;
  - kind/direction/delivery/transport tags;
  - activation or delivery result;
  - final-step consistency/failure note.
- The active route uses a teal dashed arch and a bright comet with a fading
  trail.
- Autoplay advances once and stops on the final step; playing again restarts
  from step one.
- Pointer entry or focus pauses automatically so controls remain usable.
- Controls: previous, play/pause, next, exit.
- Keyboard: left/right, space, escape.
- Progress uses a transform-scaled bar.

Evidence-backed Elliott flows:

1. Map message → Elliott.
2. Owner message → model.
3. Verified webhook → turn.
4. Model tool call → search.
5. Browser tool → companion.
6. Turn evidence → SQLite.
7. Evidence → evolution proposal.
8. Runtime events → observability map.
9. Reminder tool → Slack delivery.

## Icons

- Camera controls use one visual voice: compact filled SVG glyphs.
- Rotate left/right are mirrored circular arrows.
- Zoom is plus/minus.
- Reset is an outlined home.
- Flow controls use compact typographic transport symbols.
- Tags and states never depend only on icon or color; adjacent labels remain.

## Responsive behavior

Verified widths: 320, 375, 414, and 768 CSS px.

- Root has no horizontal scrolling.
- At ≤900 px:
  - dock becomes a two-column grid;
  - View spans both columns;
  - Ask Elliott also spans both columns so the primary input never becomes a
    cramped half-width control;
  - dock remains fully opaque;
  - nav hit targets become at least 44 × 44 px;
  - bottom gesture hint is removed;
  - flow player moves above the bottom control regions.
- Drawer width becomes `min(340px, 92vw)`.
- All clickable labels remain single-line.
- Coarse-pointer controls use a 44 px minimum height.
- Reduced motion removes ambient particles and collapses transition durations.

## Elliott data mapping

- The served topology is changed from `telemetry-map-3d-topology.json` to
  `elliott-topology.enriched.json`.
- No render metadata is required in the JSON.
- Domain boards derive from top-level `domains`.
- Deploy boards derive from `classifications.trustZone`.
- Stack layers derive from domain responsibilities.
- Node size is deliberately uniform across every component.
- Edge drawer facts derive from `contract`, `routing`, `activation`,
  `security`, and `evidence`.
- No verified node or edge is discarded: 46 nodes and 55 edges load.

## Acceptance checklist

- [x] 46 enriched nodes load.
- [x] 55 enriched edges load.
- [x] Domains view renders.
- [x] Deploy/trust view renders.
- [x] Stack view renders and resets without the reference’s empty-canvas bug.
- [x] Node drawer renders verified details.
- [x] Connection row opens edge drawer.
- [x] Ask Elliott accepts a message and opens a ten-step path trace.
- [x] Nine narrated flows load; the message flow is exposed by the primary
  input.
- [x] Zoom / rotate / reset controls have SVG icons and accessible names.
- [x] 320 / 375 / 414 / 768 have no horizontal overflow.
- [x] Mobile keeps both View and a full-width Ask Elliott input available.
- [x] Reduced-motion behavior remains functional.
