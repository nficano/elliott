import type { Board } from "../types/explorer";
import type { Projected } from "../utils/camera";
import type { Scene } from "./scene";

import { CANVAS_COLOR } from "../utils/palette";
import { facePath } from "./scene";

// One upper-left key light grounds the isometric scene (legacy parity).
export const SCENE_LIGHT = Object.freeze({
  shadowX: 0.72,
  shadowY: 0.92,
  boardBlur: 7,
  boardOpacity: 0.13,
  contactOpacity: 0.27,
});

let contactShadowCanvas: HTMLCanvasElement | undefined;

// A radial contact-shadow sprite shared by all nodes (rendered once).
export const contactShadow = (): HTMLCanvasElement => {
  if (contactShadowCanvas) return contactShadowCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    const glow = g.createRadialGradient(55, 25, 3, 64, 32, 56);
    glow.addColorStop(0, CANVAS_COLOR.contactShadowCore);
    glow.addColorStop(0.42, CANVAS_COLOR.contactShadowMid);
    glow.addColorStop(1, CANVAS_COLOR.contactShadowClear);
    g.fillStyle = glow;
    g.fillRect(0, 0, canvas.width, canvas.height);
  }
  contactShadowCanvas = canvas;
  return canvas;
};

export const paintTopLight = (
  scene: Scene,
  pts: readonly Projected[],
  alpha: number,
): void => {
  const { ctx } = scene;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const gr = ctx.createLinearGradient(minX, minY, maxX, maxY);
  gr.addColorStop(0, CANVAS_COLOR.keyLight);
  gr.addColorStop(0.58, CANVAS_COLOR.keyLightClear);
  gr.addColorStop(1, CANVAS_COLOR.lightFalloff);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gr;
  facePath(scene, pts);
  ctx.fill();
  ctx.restore();
};

export const drawBoardShadow = (
  scene: Scene,
  board: Board,
  pts: readonly Projected[],
  alpha: number,
): void => {
  if (alpha <= 0.01) return;
  const { ctx, cam } = scene;
  const k = Math.max(0.58, Math.min(1.45, cam.zoom));
  const elevation = Math.max(0, board.y);
  const lift = Math.min(24, (4 + elevation * 0.42) * k);
  ctx.save();
  ctx.translate(SCENE_LIGHT.shadowX * lift, SCENE_LIGHT.shadowY * lift);
  ctx.filter = `blur(${Math.min(15, SCENE_LIGHT.boardBlur + elevation * 0.12) * k}px)`;
  ctx.fillStyle = CANVAS_COLOR.shadowSoft;
  ctx.globalAlpha = SCENE_LIGHT.boardOpacity * alpha;
  facePath(scene, pts);
  ctx.fill();
  ctx.restore();
};
