import type { ExplorerEdge, ExplorerNode } from "../types/explorer";
import type { Projected } from "../utils/camera";
import type { Scene } from "./scene";
import type { EngineState } from "./state";

import { SCALE } from "../utils/camera";
import { point } from "../utils/camera";
import { nodeHeight } from "../utils/layout";
import { CANVAS_COLOR, hash01 } from "../utils/palette";
import { visualNodeFoot } from "./nodes";
import { proj, qPoint } from "./scene";
import { effectiveBrightness } from "./state";

export interface EdgeCurve {
  a: Projected;
  b: Projected;
  c: Projected;
}

export const newCurve = (): EdgeCurve => ({
  a: point(),
  b: point(),
  c: point(),
});

const clipTraceAnchor = (
  scene: Scene,
  ends: { center: Projected; toward: Projected; },
  node: ExplorerNode,
): { x: number; y: number; } => {
  const dx = ends.toward.x - ends.center.x;
  const dy = ends.toward.y - ends.center.y;
  const rx = visualNodeFoot(node) * SCALE * scene.cam.zoom * 0.58;
  const ry = Math.max(5, visualNodeFoot(node) * SCALE * scene.cam.zoom * 0.25);
  const denom = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)) || 1;
  return { x: ends.center.x + dx / denom, y: ends.center.y + dy / denom };
};

// Project an edge as a raised quadratic arc clipped to node silhouettes.
export const edgeCurve = (
  scene: Scene,
  state: EngineState,
  edge: Pick<ExplorerEdge, "from" | "to">,
  out: EdgeCurve,
): EdgeCurve => {
  const aNode = state.nodesById.get(edge.from);
  const bNode = state.nodesById.get(edge.to);
  if (!aNode || !bNode) return out;
  const y1 = aNode.rs.y + nodeHeight() + 0.15;
  const y2 = bNode.rs.y + nodeHeight() + 0.15;
  const mx = (aNode.rs.x + bNode.rs.x) / 2;
  const mz = (aNode.rs.z + bNode.rs.z) / 2;
  const dist = Math.hypot(
    bNode.rs.x - aNode.rs.x,
    bNode.rs.z - aNode.rs.z,
    y2 - y1,
  );
  const my = Math.max(y1, y2) + 1.1 + dist * 0.1;
  const start = proj(scene, [aNode.rs.x, y1, aNode.rs.z]);
  proj(scene, [mx, my, mz], out.c);
  const end = proj(scene, [bNode.rs.x, y2, bNode.rs.z]);
  const a = clipTraceAnchor(scene, { center: start, toward: out.c }, aNode);
  const b = clipTraceAnchor(scene, { center: end, toward: out.c }, bNode);
  out.a.x = a.x;
  out.a.y = a.y;
  out.b.x = b.x;
  out.b.y = b.y;
  return out;
};

const scratch = point();

const edgeAlpha = (
  state: EngineState,
  flags: { inFocus: boolean; hot: boolean; dash: boolean; },
): number => {
  const brightness = effectiveBrightness(state);
  let alpha = flags.inFocus
    ? flags.hot ? 0.98 : flags.dash ? 0.3 : 0.52
    : 0.035;
  if (state.flow) alpha = flags.inFocus ? 0.76 : 0.025;
  else if (brightness === "dim") alpha *= flags.hot ? 0.68 : 0.34;
  return alpha;
};

const drawArrowhead = (
  scene: Scene,
  curve: EdgeCurve,
  style: { color: string; alpha: number; hot: boolean; },
): void => {
  const { ctx, cam } = scene;
  qPoint(curve.a, curve.c, curve.b, 0.88, scratch);
  const dx = curve.b.x - scratch.x;
  const dy = curve.b.y - scratch.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const s = (style.hot ? 7 : 5) * Math.max(0.7, cam.zoom * 0.8);
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.shadowColor = style.color;
  ctx.shadowBlur = style.hot ? 9 : 0;
  ctx.fillStyle = style.color;
  ctx.beginPath();
  ctx.moveTo(curve.b.x, curve.b.y);
  ctx.lineTo(curve.b.x - ux * s - uy * s * 0.5, curve.b.y - uy * s + ux * s * 0.5);
  ctx.lineTo(curve.b.x - ux * s + uy * s * 0.5, curve.b.y - uy * s - ux * s * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawAgentJunction = (
  scene: Scene,
  state: EngineState,
  edge: ExplorerEdge,
  frame: { curve: EdgeCurve; hot: boolean; },
): void => {
  if (edge.from !== "runtime.agentLoop" && edge.to !== "runtime.agentLoop") {
    return;
  }
  const { ctx, cam } = scene;
  const brightness = effectiveBrightness(state);
  const junction = edge.from === "runtime.agentLoop"
    ? frame.curve.a
    : frame.curve.b;
  ctx.save();
  ctx.globalAlpha = (frame.hot ? 0.98 : 0.72) * (brightness === "dim" ? 0.48 : 1);
  ctx.fillStyle = CANVAS_COLOR.accentGreen;
  ctx.shadowColor = CANVAS_COLOR.accentGreen;
  ctx.shadowBlur = brightness === "dim" ? (frame.hot ? 8 : 4) : (frame.hot ? 13 : 8);
  ctx.beginPath();
  ctx.arc(
    junction.x,
    junction.y,
    (frame.hot ? 3.8 : 2.6) * Math.max(0.75, cam.zoom),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
};

const isEdgeHot = (state: EngineState, edge: ExplorerEdge): boolean =>
  state.selectedEdge === edge
  || (state.hovered !== null
    && (edge.from === state.hovered.id || edge.to === state.hovered.id))
  || (state.selected !== null
    && (edge.from === state.selected.id || edge.to === state.selected.id));

// Draw one edge: soft glow pass, core stroke, arrowhead, agent junction, and
// (when highlighted) a kind pill at the apex.
export const drawEdge = (
  scene: Scene,
  state: EngineState,
  edge: ExplorerEdge,
  focus: Set<string> | null,
): void => {
  const { ctx, cam } = scene;
  const style = state.edgeStyle.get(edge.kind)
    ?? { color: CANVAS_COLOR.edgeFallback, width: 1.5, dash: true };
  const inFocus = focus ? focus.has(edge.from) && focus.has(edge.to) : true;
  const hot = isEdgeHot(state, edge);
  const brightness = effectiveBrightness(state);
  if (brightness === "off") return;
  const alpha = edgeAlpha(state, { inFocus, hot, dash: style.dash });
  const curve = newCurve();
  edgeCurve(scene, state, edge, curve);
  const width = (hot ? 2.7 : 1.8) * Math.max(0.72, cam.zoom * 0.84);
  const dash = style.dash ? [7 * cam.zoom, 6 * cam.zoom] : [];
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dash);
  ctx.strokeStyle = style.color;
  ctx.globalAlpha = alpha * (style.dash ? 0.34 : 0.44);
  ctx.lineWidth = width + (hot ? 3.6 : 2.2);
  ctx.shadowColor = style.color;
  ctx.shadowBlur = brightness === "dim" ? (hot ? 8 : 4) : (hot ? 12 : 8);
  ctx.beginPath();
  ctx.moveTo(curve.a.x, curve.a.y);
  ctx.quadraticCurveTo(curve.c.x, curve.c.y, curve.b.x, curve.b.y);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(curve.a.x, curve.a.y);
  ctx.quadraticCurveTo(curve.c.x, curve.c.y, curve.b.x, curve.b.y);
  ctx.stroke();
  ctx.restore();
  if (hot || cam.zoom > 1.1) {
    drawArrowhead(scene, curve, { color: style.color, alpha, hot });
  }
  drawAgentJunction(scene, state, edge, { curve, hot });
};

// ---- particles -------------------------------------------------------------

interface Particle {
  t: number;
}

const edgeParts = new Map<string, Particle[]>();

const partsFor = (edge: ExplorerEdge): Particle[] => {
  let ps = edgeParts.get(edge.id);
  if (!ps) {
    const count = edge.motion.count || 1;
    ps = Array.from({ length: count }, (_, i) => ({
      t: (i / count + hash01(edge.id) * 0.5) % 1,
    }));
    edgeParts.set(edge.id, ps);
  }
  return ps;
};

// Qualitative motion grammar only; never presented as measured traffic.
export const drawParticles = (
  scene: Scene,
  state: EngineState,
  edge: ExplorerEdge,
  frame: { dt: number; focus: Set<string> | null; },
): void => {
  const { ctx, cam } = scene;
  if (cam.zoom < 0.42) return;
  const brightness = effectiveBrightness(state);
  if (brightness === "off") return;
  const style = state.edgeStyle.get(edge.kind);
  const color = style?.color ?? CANVAS_COLOR.edgeFallback;
  const inFocus = frame.focus
    ? frame.focus.has(edge.from) && frame.focus.has(edge.to)
    : true;
  if (!inFocus && (state.selected || state.selectedEdge || state.flow)) return;
  const hot = state.selected !== null
    && (edge.from === state.selected.id || edge.to === state.selected.id);
  const speed = edge.motion.speed || 0.065;
  const size = (edge.motion.size || 2.2) * Math.max(0.7, cam.zoom);
  const curve = newCurve();
  edgeCurve(scene, state, edge, curve);
  const dimK = brightness === "dim" ? 0.45 : 1;
  for (const p of partsFor(edge)) {
    p.t = (p.t + frame.dt * speed) % 1;
    qPoint(curve.a, curve.c, curve.b, p.t, scratch);
    ctx.globalAlpha = (hot ? 0.95 : 0.55) * dimK;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(scratch.x, scratch.y, size, 0, 7);
    ctx.fill();
    ctx.globalAlpha = (hot ? 0.25 : 0.1) * dimK;
    ctx.beginPath();
    ctx.arc(scratch.x, scratch.y, size * 2.1, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
};
