import type { Projected } from "../utils/camera";
import type { Scene } from "./scene";

import { shade } from "../utils/palette";
import { paintTopLight } from "./lighting";
import { facePath, proj } from "./scene";

export interface PrismSpec {
  cx: number;
  cz: number;
  corners: readonly [number, number][];
  y0: number;
  h: number;
  color: string;
  alpha: number;
  topLight?: number;
}

const sideLuminance = (
  az: number,
  edge: readonly [number, number, number, number],
): number => {
  const [ax, az0, bx, bz] = edge;
  const ex = bx - ax;
  const ez = bz - az0;
  const c = Math.cos(az);
  const s = Math.sin(az);
  const nx = ez * c - -ex * s;
  const nz = ez * s + -ex * c;
  return -0.16 - 0.14 * (Math.atan2(nz, nx) > 0 ? 1 : 0)
    + 0.1 * Math.max(0, nx / Math.hypot(nx, nz));
};

// Generic prism from a footprint corner list (world XZ, ccw): visible side
// faces shaded by orientation, lit top face with outline. Returns the
// projected top-face points.
export const prism = (scene: Scene, spec: PrismSpec): Projected[] => {
  const { ctx, cam } = scene;
  const { cx, cz, corners, y0, h, color, alpha } = spec;
  const topLight = spec.topLight ?? 0.32;
  const n = corners.length;
  const top: Projected[] = [];
  const bot: Projected[] = [];
  let cdepth = 0;
  for (const [dx, dz] of corners) {
    const wx = cx + dx;
    const wz = cz + dz;
    top.push(proj(scene, [wx, y0 + h, wz]));
    const b = proj(scene, [wx, y0, wz]);
    bot.push(b);
    cdepth += b.d;
  }
  cdepth /= n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const bi = bot[i];
    const bj = bot[j];
    const ti = top[i];
    const tj = top[j];
    if (!bi || !bj || !ti || !tj) continue;
    if ((bi.d + bj.d) / 2 > cdepth + 1e-6) {
      const ci = corners[i];
      const cj = corners[j];
      if (!ci || !cj) continue;
      const lum = sideLuminance(cam.az, [ci[0], ci[1], cj[0], cj[1]]);
      ctx.fillStyle = shade(color, Math.max(-0.42, lum), alpha);
      facePath(scene, [ti, tj, bj, bi]);
      ctx.fill();
    }
  }
  ctx.fillStyle = shade(color, topLight, alpha);
  facePath(scene, top);
  ctx.fill();
  paintTopLight(scene, top, alpha);
  ctx.strokeStyle = shade(color, 0.55, alpha * 0.8);
  ctx.lineWidth = 1;
  facePath(scene, top);
  ctx.stroke();
  return top;
};
