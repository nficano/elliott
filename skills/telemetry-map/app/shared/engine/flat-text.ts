import type { Scene } from "./scene";

import { proj } from "./scene";

export const DECK_FONT = "\"Inter\", ui-sans-serif, system-ui, sans-serif";

let measureContext: CanvasRenderingContext2D | undefined;

// Width of text in world units at the deck font (legacy measureWorld).
export const measureWorld = (text: string): number => {
  measureContext ??= document.createElement("canvas").getContext("2d")
    ?? undefined;
  if (!measureContext) return text.length * 0.5;
  measureContext.font = `650 100px ${DECK_FONT}`;
  return measureContext.measureText(text).width / 100;
};

export interface FlatTextSpec {
  text: string;
  wx: number;
  wy: number;
  wz: number;
  size: number;
  color: string;
  align?: CanvasTextAlign;
  font?: string;
  tracking?: string;
}

// Draw text lying flat on the ground plane (the icraft signature look).
export const isoText = (scene: Scene, spec: FlatTextSpec): void => {
  const { ctx, dpr } = scene;
  const o = proj(scene, [spec.wx, spec.wy, spec.wz]);
  const px = proj(scene, [spec.wx + 1, spec.wy, spec.wz]);
  const pz = proj(scene, [spec.wx, spec.wy, spec.wz + 1]);
  ctx.save();
  ctx.setTransform(
    dpr * (px.x - o.x),
    dpr * (px.y - o.y),
    dpr * (pz.x - o.x),
    dpr * (pz.y - o.y),
    dpr * o.x,
    dpr * o.y,
  );
  ctx.font = spec.font ?? `600 ${spec.size}px ${DECK_FONT}`;
  ctx.letterSpacing = spec.tracking ?? "0px";
  ctx.fillStyle = spec.color;
  ctx.textAlign = spec.align ?? "left";
  ctx.textBaseline = "middle";
  ctx.fillText(spec.text, 0, 0);
  ctx.restore();
};
