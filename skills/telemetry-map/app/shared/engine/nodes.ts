import type { ExplorerNode } from "../types/explorer";
import type { Scene } from "./scene";

import { SCALE } from "../utils/camera";
import {
  nodeHeight,
  SYSTEM_FOOTPRINT_WIDTH,
  UNIFORM_NODE_FOOT,
} from "../utils/layout";
import { CANVAS_COLOR, domainColor } from "../utils/palette";
import { DECK_FONT, isoText, measureWorld } from "./flat-text";
import { contactShadow, SCENE_LIGHT } from "./lighting";
import { prism } from "./prism";
import { facePath, proj, roundedRectCorners } from "./scene";

const DATABASE_KINDS = new Set([
  "kv",
  "database",
  "graph-store",
  "search-index",
  "object-store",
  "warehouse",
]);
const DATABASE_NODE_IDS = new Set(["container.postgres"]);
const HERO_NODE_IDS = new Set(["runtime.agentLoop"]);
export const NODE_GLYPH_MARGIN = 0.22;

export const isDatabaseNode = (node: ExplorerNode): boolean =>
  node.visual.shapeClass === "database"
  || DATABASE_KINDS.has(node.kind ?? "")
  || DATABASE_NODE_IDS.has(node.id);

export const displayKind = (node: ExplorerNode): string =>
  isDatabaseNode(node) && node.kind !== "database"
    ? `database · ${node.kind}`
    : node.kind ?? "";

export const isHeroNode = (node: ExplorerNode): boolean =>
  HERO_NODE_IDS.has(node.id);

export const visualNodeFoot = (node: ExplorerNode): number =>
  UNIFORM_NODE_FOOT * (isHeroNode(node) ? 1.13 : 1);

// ---- top-face brand glyphs -------------------------------------------------

const NODE_TOP_GLYPHS = new Map<string, HTMLCanvasElement>();

export const registerNodeGlyph = (
  id: string,
  svg: string,
  px = 256,
): void => {
  const img = new Image();
  img.addEventListener("load", () => {
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    canvas.getContext("2d")?.drawImage(img, 0, 0, px, px);
    NODE_TOP_GLYPHS.set(id, canvas);
  });
  img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const registerNodeGlyphAsset = async (
  base: string,
  ids: readonly string[],
  file: string,
  recolor = false,
): Promise<void> => {
  try {
    const response = await fetch(`${base}/icon/${file}`);
    if (!response.ok) return;
    let svg = await response.text();
    if (recolor) {
      svg = svg
        .replaceAll("currentColor", CANVAS_COLOR.paper)
        .replaceAll(/#000(?:000)?/gi, CANVAS_COLOR.paper);
    }
    for (const id of ids) registerNodeGlyph(id, svg);
  } catch {
    // Icons are decoration; a failed fetch must not break the scene.
  }
};

export const drawNodeShadow = (
  scene: Scene,
  node: ExplorerNode,
  alpha: number,
): void => {
  if (alpha <= 0.01) return;
  const { ctx, cam } = scene;
  const foot = visualNodeFoot(node);
  const height = nodeHeight();
  const base = proj(scene, [node.rs.x, node.rs.y + 0.01, node.rs.z]);
  const k = Math.max(0.58, Math.min(1.5, cam.zoom));
  const lift = (3.2 + height * 2.6) * k;
  const width = foot * SCALE * cam.zoom * 1.08;
  ctx.save();
  ctx.globalAlpha = SCENE_LIGHT.contactOpacity * alpha;
  ctx.drawImage(
    contactShadow(),
    base.x + SCENE_LIGHT.shadowX * lift - width,
    base.y + SCENE_LIGHT.shadowY * lift - width * 0.29,
    width * 2,
    width * 0.58,
  );
  ctx.restore();
};

const drawGlyph = (scene: Scene, node: ExplorerNode, alpha: number): void => {
  const glyph = NODE_TOP_GLYPHS.get(node.id);
  if (!glyph || alpha <= 0.01) return;
  const { ctx, dpr } = scene;
  const foot = visualNodeFoot(node);
  const top = node.rs.y + nodeHeight();
  const s = 1 - 2 * NODE_GLYPH_MARGIN;
  const hw = ((foot * SYSTEM_FOOTPRINT_WIDTH) / 2) * s;
  const hd = ((foot * 0.72) / 2) * s;
  const { x, z } = { x: node.rs.x, z: node.rs.z };
  const o = proj(scene, [x - hw, top, z - hd]);
  const ex = proj(scene, [x + hw, top, z - hd]);
  const ez = proj(scene, [x - hw, top, z + hd]);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "grayscale(1) brightness(2.35)";
  ctx.setTransform(
    (dpr * (ex.x - o.x)) / glyph.width,
    (dpr * (ex.y - o.y)) / glyph.width,
    (dpr * (ez.x - o.x)) / glyph.height,
    (dpr * (ez.y - o.y)) / glyph.height,
    dpr * o.x,
    dpr * o.y,
  );
  ctx.drawImage(glyph, 0, 0);
  ctx.restore();
};

const drawAccent = (
  scene: Scene,
  node: ExplorerNode,
  paint: { alpha: number; hot: boolean; },
): void => {
  const { ctx, cam } = scene;
  const foot = visualNodeFoot(node);
  const top = node.rs.y + nodeHeight() + 0.018;
  const accent = domainColor(node);
  const emphasized = paint.hot || isHeroNode(node);
  const p1 = proj(scene, [node.rs.x - foot * 0.22, top, node.rs.z + foot * 0.18]);
  const p2 = proj(scene, [node.rs.x + foot * 0.22, top, node.rs.z + foot * 0.18]);
  ctx.save();
  ctx.globalAlpha = paint.alpha * (emphasized ? 0.95 : 0.66);
  ctx.strokeStyle = accent;
  ctx.lineWidth = (emphasized ? 2.2 : 1.25) * Math.max(0.72, cam.zoom);
  ctx.lineCap = "round";
  if (emphasized) {
    ctx.shadowColor = accent;
    ctx.shadowBlur = isHeroNode(node) ? 15 : 9;
  }
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.restore();
  if (isHeroNode(node)) {
    isoText(scene, {
      text: "AI",
      wx: node.rs.x,
      wy: top,
      wz: node.rs.z - 0.02,
      size: 0.31,
      color: CANVAS_COLOR.paper,
      align: "center",
      font: `700 .31px ${DECK_FONT}`,
      tracking: ".04em",
    });
  }
};

const drawTileLabel = (
  scene: Scene,
  node: ExplorerNode,
  paint: { alpha: number; hot: boolean; },
): void => {
  const { ctx, cam } = scene;
  const emphasized = paint.hot || isHeroNode(node);
  if (cam.zoom < 0.68 && !emphasized) return;
  const foot = visualNodeFoot(node);
  const maxW = foot * SYSTEM_FOOTPRINT_WIDTH * 0.76;
  const measured = measureWorld(node.name);
  const size = Math.max(
    0.12,
    Math.min(isHeroNode(node) ? 0.22 : 0.18, maxW / (measured || 1)),
  );
  const color = emphasized ? CANVAS_COLOR.paperBright : CANVAS_COLOR.paper;
  ctx.save();
  ctx.globalAlpha = paint.alpha * (emphasized ? 0.98 : 0.76);
  if (emphasized) {
    ctx.shadowColor = domainColor(node);
    ctx.shadowBlur = isHeroNode(node) ? 8 : 5;
  }
  isoText(scene, {
    text: node.name,
    wx: node.rs.x,
    wy: node.rs.y + nodeHeight() + 0.026,
    wz: node.rs.z + foot * 0.23,
    size,
    color,
    align: "center",
    font: `650 ${size}px ${DECK_FONT}`,
    tracking: ".015em",
  });
  ctx.restore();
};

const drawLifecycleMarker = (
  scene: Scene,
  node: ExplorerNode,
  height: number,
): void => {
  const { ctx, cam } = scene;
  const lifecycle = node.runtime.lifecycle;
  if (lifecycle === "active" || cam.zoom <= 0.6) return;
  const foot = visualNodeFoot(node);
  const marker = proj(scene, [node.rs.x, node.rs.y + height + 0.42, node.rs.z]);
  ctx.fillStyle = lifecycle === "migration"
    ? CANVAS_COLOR.migration
    : CANVAS_COLOR.proposed;
  ctx.beginPath();
  ctx.arc(
    marker.x + foot * SCALE * cam.zoom * 0.5,
    marker.y,
    3.2 * cam.zoom,
    0,
    7,
  );
  ctx.fill();
  ctx.strokeStyle = CANVAS_COLOR.whiteStroke;
  ctx.lineWidth = 1;
  ctx.stroke();
};

// Paint a node: rounded prism, top outline, glyph, accent, label, marker.
export const drawNodeShape = (
  scene: Scene,
  node: ExplorerNode,
  paint: { alpha: number; hot: boolean; },
): void => {
  const { ctx, cam } = scene;
  const foot = visualNodeFoot(node);
  const height = nodeHeight();
  const w = foot * SYSTEM_FOOTPRINT_WIDTH;
  const d = foot * 0.72;
  const top = prism(scene, {
    cx: node.rs.x,
    cz: node.rs.z,
    corners: roundedRectCorners(w, d, Math.min(w, d) * 0.22),
    y0: node.rs.y,
    h: height,
    color: CANVAS_COLOR.tile,
    alpha: paint.alpha,
    topLight: 0.07,
  });
  const emphasized = paint.hot || isHeroNode(node);
  ctx.save();
  ctx.globalAlpha = paint.alpha * (emphasized ? 0.92 : 0.28);
  ctx.strokeStyle = emphasized ? domainColor(node) : CANVAS_COLOR.whiteStroke;
  ctx.lineWidth = (emphasized ? 1.6 : 1) * Math.max(0.7, cam.zoom);
  if (emphasized) {
    ctx.shadowColor = domainColor(node);
    ctx.shadowBlur = isHeroNode(node) ? 18 : 10;
  }
  facePath(scene, top);
  ctx.stroke();
  ctx.restore();
  drawLifecycleMarker(scene, node, height);
  drawGlyph(scene, node, paint.alpha);
  drawAccent(scene, node, paint);
  drawTileLabel(scene, node, paint);
};
