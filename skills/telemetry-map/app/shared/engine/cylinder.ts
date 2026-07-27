import type { Projected } from "../utils/camera";
import type { Scene } from "./scene";

import { shade } from "../utils/palette";
import { paintTopLight } from "./lighting";
import { facePath, proj } from "./scene";

// The canonical database symbol: an elliptical cylinder with a lit top disc
// and cross-section slice lines along the barrel. Returns the projected top
// ring so callers can outline it exactly like a prism top face.

export interface CylinderSpec {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  y0: number;
  h: number;
  color: string;
  alpha: number;
  topLight?: number;
  slices?: number;
}

const SEGMENTS = 40;

const ringPoints = (
  scene: Scene,
  spec: CylinderSpec,
  y: number,
): Projected[] => {
  const pts: Projected[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    pts.push(
      proj(scene, [
        spec.cx + Math.cos(a) * spec.rx,
        y,
        spec.cz + Math.sin(a) * spec.rz,
      ]),
    );
  }
  return pts;
};

// Silhouette tangents: the left- and rightmost projected ring points. A
// vertical world offset is a pure screen-y shift under this camera, so the
// same indices bound the barrel on every ring of the cylinder.
const extremes = (pts: readonly Projected[]): [number, number] => {
  let left = 0;
  let right = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (!p) continue;
    if (p.x < (pts[left]?.x ?? Infinity)) left = i;
    if (p.x > (pts[right]?.x ?? -Infinity)) right = i;
  }
  return [left, right];
};

const walkIndices = (from: number, to: number, dir: 1 | -1): number[] => {
  const out = [from];
  let i = from;
  while (i !== to) {
    i = (i + dir + SEGMENTS) % SEGMENTS;
    out.push(i);
  }
  return out;
};

// Indices of the near-side arc (left tangent → right tangent), picked as the
// walk whose points sit lower on screen — the viewer-facing half.
const frontIndices = (pts: readonly Projected[]): number[] => {
  const [left, right] = extremes(pts);
  const meanY = (idx: readonly number[]): number =>
    idx.reduce((sum, i) => sum + (pts[i]?.y ?? 0), 0) / idx.length;
  const forward = walkIndices(left, right, 1);
  const backward = walkIndices(left, right, -1);
  return meanY(forward) >= meanY(backward) ? forward : backward;
};

const tracePolyline = (
  scene: Scene,
  pts: readonly Projected[],
  indices: readonly number[],
): void => {
  const { ctx } = scene;
  for (const [j, i] of indices.entries()) {
    const p = pts[i];
    if (!p) continue;
    if (j === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
};

const drawBarrel = (
  scene: Scene,
  spec: CylinderSpec,
  rings: { bottom: Projected[]; top: Projected[]; front: number[]; },
): void => {
  const { ctx } = scene;
  const { bottom, top, front } = rings;
  const l = bottom[front[0] ?? 0];
  const r = bottom[front.at(-1) ?? 0];
  if (!l || !r) return;
  // Sheen mirrors the prism side-shading range, biased toward the key light.
  const grad = ctx.createLinearGradient(l.x, 0, r.x, 0);
  grad.addColorStop(0, shade(spec.color, -0.34, spec.alpha));
  grad.addColorStop(0.38, shade(spec.color, -0.05, spec.alpha));
  grad.addColorStop(1, shade(spec.color, -0.3, spec.alpha));
  ctx.fillStyle = grad;
  ctx.beginPath();
  tracePolyline(scene, bottom, front);
  tracePolyline(scene, top, front.toReversed());
  ctx.closePath();
  ctx.fill();
};

// The diagram-style cross sections: front arcs slicing the barrel into
// evenly stacked discs.
const drawSlices = (
  scene: Scene,
  spec: CylinderSpec,
  front: readonly number[],
): void => {
  const { ctx } = scene;
  const count = spec.slices ?? 2;
  ctx.strokeStyle = shade(spec.color, 0.55, spec.alpha * 0.55);
  ctx.lineWidth = 1;
  for (let s = 1; s <= count; s++) {
    const ringY = spec.y0 + (spec.h * s) / (count + 1);
    const slice = ringPoints(scene, spec, ringY);
    ctx.beginPath();
    tracePolyline(scene, slice, front);
    ctx.stroke();
  }
};

const drawTopDisc = (
  scene: Scene,
  spec: CylinderSpec,
  top: readonly Projected[],
): void => {
  const { ctx } = scene;
  ctx.fillStyle = shade(spec.color, spec.topLight ?? 0.32, spec.alpha);
  facePath(scene, top);
  ctx.fill();
  paintTopLight(scene, top, spec.alpha);
  ctx.strokeStyle = shade(spec.color, 0.55, spec.alpha * 0.8);
  ctx.lineWidth = 1;
  facePath(scene, top);
  ctx.stroke();
};

export const cylinder = (scene: Scene, spec: CylinderSpec): Projected[] => {
  const bottom = ringPoints(scene, spec, spec.y0);
  const top = ringPoints(scene, spec, spec.y0 + spec.h);
  const front = frontIndices(bottom);
  drawBarrel(scene, spec, { bottom, top, front });
  drawSlices(scene, spec, front);
  drawTopDisc(scene, spec, top);
  return top;
};
