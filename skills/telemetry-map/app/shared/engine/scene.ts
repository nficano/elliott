import type { CameraState, Projected, Viewport } from "../utils/camera";

import { point, project } from "../utils/camera";

// Everything a painter needs to draw one frame.
export interface Scene {
  ctx: CanvasRenderingContext2D;
  cam: CameraState;
  view: Viewport;
  dpr: number;
}

export const proj = (
  scene: Scene,
  world: readonly [number, number, number],
  out?: Projected,
): Projected => project(scene.cam, scene.view, world, out ?? point());

// Build a closed path from projected points on the scene context.
export const facePath = (
  scene: Scene,
  pts: readonly Projected[],
): void => {
  const { ctx } = scene;
  ctx.beginPath();
  const first = pts[0];
  if (first === undefined) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p !== undefined) ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
};

export const rectCorners = (
  w: number,
  d: number,
): [number, number][] => {
  const hw = w / 2;
  const hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
};

export const roundedRectCorners = (
  w: number,
  d: number,
  r: number,
  steps = 4,
): [number, number][] => {
  const hw = w / 2;
  const hd = d / 2;
  const rr = Math.min(r, hw, hd);
  const out: [number, number][] = [];
  const arcs: [number, number, number, number][] = [
    [hw - rr, -hd + rr, -Math.PI / 2, 0],
    [hw - rr, hd - rr, 0, Math.PI / 2],
    [-hw + rr, hd - rr, Math.PI / 2, Math.PI],
    [-hw + rr, -hd + rr, Math.PI, Math.PI * 1.5],
  ];
  for (const [cx, cz, a0, a1] of arcs) {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      out.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
    }
  }
  return out;
};

// Quadratic bezier point (matches the legacy qPoint).
export const qPoint = (
  a: Projected,
  c: Projected,
  b: Projected,
  t: number,
  out: Projected,
): Projected => {
  const u = 1 - t;
  out.x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
  out.y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
  return out;
};
