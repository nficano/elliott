import type { ExplorerNode } from "../types/explorer";
import type { Scene } from "./scene";

import { SCALE } from "../utils/camera";
import {
  nodeHeight,
  SYSTEM_FOOTPRINT_WIDTH,
  UNIFORM_NODE_FOOT,
} from "../utils/layout";
import { CANVAS_COLOR, domainColor } from "../utils/palette";
import { cylinder } from "./cylinder";
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
// Databases render as tall drums so a stack reads at a glance — noticeably
// taller and larger than a regular tile.
const DATABASE_HEIGHT_SCALE = 2.6;
const DATABASE_FOOT_SCALE = 1.05;
// The accent divider sits well above the tile label (label z ≈ foot·0.23)
// so it never crowds the text.
const ACCENT_Z = 0.05;

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
  UNIFORM_NODE_FOOT
  * (isHeroNode(node) ? 1.13 : 1)
  * (isDatabaseNode(node) ? DATABASE_FOOT_SCALE : 1);

export const visualNodeHeight = (node: ExplorerNode): number =>
  nodeHeight() * (isDatabaseNode(node) ? DATABASE_HEIGHT_SCALE : 1);

export const drawNodeShadow = (
  scene: Scene,
  node: ExplorerNode,
  alpha: number,
): void => {
  if (alpha <= 0.01) return;
  const { ctx, cam } = scene;
  const foot = visualNodeFoot(node);
  const height = visualNodeHeight(node);
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

const drawAccent = (
  scene: Scene,
  node: ExplorerNode,
  paint: { alpha: number; hot: boolean; },
): void => {
  const { ctx, cam } = scene;
  const foot = visualNodeFoot(node);
  const top = node.rs.y + visualNodeHeight(node) + 0.018;
  const accent = domainColor(node);
  const emphasized = paint.hot || isHeroNode(node);
  const p1 = proj(scene, [node.rs.x - foot * 0.22, top, node.rs.z + foot * ACCENT_Z]);
  const p2 = proj(scene, [node.rs.x + foot * 0.22, top, node.rs.z + foot * ACCENT_Z]);
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
    wy: node.rs.y + visualNodeHeight(node) + 0.026,
    wz: node.rs.z + foot * 0.23,
    size,
    color,
    align: "center",
    font: `650 ${size}px ${DECK_FONT}`,
    tracking: ".015em",
  });
  ctx.restore();
};

// Paint a node: rounded prism, top outline, glyph, accent, label, marker.
export const drawNodeShape = (
  scene: Scene,
  node: ExplorerNode,
  paint: { alpha: number; hot: boolean; },
): void => {
  const { ctx, cam } = scene;
  const foot = visualNodeFoot(node);
  const height = visualNodeHeight(node);
  const w = foot * SYSTEM_FOOTPRINT_WIDTH;
  const d = foot * 0.72;
  // A perfect cylinder needs equal world radii; use the depth so the top is a
  // true circle. w/2 would make an elliptical top disc.
  const r = d / 2;
  const top = isDatabaseNode(node)
    ? cylinder(scene, {
        cx: node.rs.x,
        cz: node.rs.z,
        rx: r,
        rz: r,
        y0: node.rs.y,
        h: height,
        color: CANVAS_COLOR.tile,
        alpha: paint.alpha,
        topLight: 0.07,
      })
    : prism(scene, {
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
  drawAccent(scene, node, paint);
  drawTileLabel(scene, node, paint);
};
