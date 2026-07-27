import type { Scene } from "./scene";

import { CANVAS_COLOR } from "../utils/palette";

export type SpriteStyle = "board" | "zone" | "node";

const labelCache = new Map<string, HTMLCanvasElement>();

export const clearLabelCache = (): void => {
  labelCache.clear();
};

// Rasterize a pill label once; reused every frame (legacy labelSprite).
export const labelSprite = (
  text: string,
  style: SpriteStyle,
): HTMLCanvasElement => {
  const key = `${style}|${text}`;
  const cached = labelCache.get(key);
  if (cached) return cached;
  const big = style === "board";
  const zone = style === "zone";
  const fs = big ? 26 : (zone ? 18 : 20);
  const pad = big ? 16 : 10;
  const h = fs + pad * 1.35;
  const canvas = document.createElement("canvas");
  const measure = canvas.getContext("2d");
  if (!measure) return canvas;
  const font =
    `${big ? 700 : 600} ${fs}px "Inter", ui-sans-serif, system-ui, sans-serif`;
  measure.font = font;
  const tw = measure.measureText(text).width;
  canvas.width = Math.ceil(tw + pad * 2.2);
  canvas.height = Math.ceil(h);
  const g = canvas.getContext("2d");
  if (!g) return canvas;
  const r = canvas.height / 2;
  g.beginPath();
  g.moveTo(r, 0);
  g.arcTo(canvas.width, 0, canvas.width, canvas.height, r);
  g.arcTo(canvas.width, canvas.height, 0, canvas.height, r);
  g.arcTo(0, canvas.height, 0, 0, r);
  g.arcTo(0, 0, canvas.width, 0, r);
  g.closePath();
  g.fillStyle = big
    ? CANVAS_COLOR.labelDark
    : (zone
    ? CANVAS_COLOR.labelClear
    : CANVAS_COLOR.labelPaper);
  if (!zone) g.fill();
  if (!big && !zone) {
    g.lineWidth = 2;
    g.strokeStyle = CANVAS_COLOR.labelLine;
    g.stroke();
  }
  g.font = font;
  g.fillStyle = big
    ? CANVAS_COLOR.paper
    : (zone
    ? CANVAS_COLOR.labelZone
    : CANVAS_COLOR.ink);
  g.textBaseline = "middle";
  g.textAlign = "center";
  g.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  labelCache.set(key, canvas);
  return canvas;
};

export const drawSprite = (
  scene: Scene,
  sprite: HTMLCanvasElement,
  at: readonly [number, number, number],
): void => {
  const [x, y, k] = at;
  scene.ctx.drawImage(
    sprite,
    x - (sprite.width * k) / 2,
    y - (sprite.height * k) / 2,
    sprite.width * k,
    sprite.height * k,
  );
};

// Refresh cached sprites once webfonts finish loading.
export const bindFontReload = (): void => {
  document.fonts?.ready?.then(() => {
    labelCache.clear();
  }).catch(() => {});
};
