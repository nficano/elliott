import type { Board } from "../types/explorer";
import type { Scene } from "./scene";
import type { EngineState } from "./state";

import { GROUND_GRID_STEP } from "../utils/layout";
import { CANVAS_COLOR, shade } from "../utils/palette";
import { isoText, measureWorld } from "./flat-text";
import { drawBoardShadow } from "./lighting";
import { prism } from "./prism";
import { facePath, proj, roundedRectCorners } from "./scene";

// Deck title fitted inside the board along its front edge; shrinks to fit.
const drawDeckTitle = (scene: Scene, board: Board): void => {
  const title = (board.name || "").toUpperCase();
  const maxW = Math.max(3, board.w - 3.2);
  const color = shade(board.color || CANVAS_COLOR.boardFallback, 0.12, 0.78);
  let size = 0.48;
  const fullW = measureWorld(title);
  if (fullW * size > maxW) size = Math.max(0.34, maxW / fullW);
  const x0 = board.x - board.w / 2 + 0.9;
  const z0 = board.z + board.d / 2 - 0.74;
  isoText(scene, {
    text: title,
    wx: x0,
    wy: board.y + 0.02,
    wz: z0,
    size,
    color,
    align: "left",
    font: `650 ${size}px "Inter", ui-sans-serif, system-ui, sans-serif`,
    tracking: ".1em",
  });
};

// Paint one platform slab with shadow, outline, cluster zones, and title.
export const drawBoard = (
  scene: Scene,
  state: EngineState,
  board: Board,
): void => {
  const { ctx, cam } = scene;
  const a = board.alpha;
  if (a <= 0.01) return;
  const y = board.y - 0.28;
  const corners = roundedRectCorners(board.w, board.d, 0.62, 5);
  const shadowPts = corners.map(([dx, dz]) =>
    proj(scene, [board.x + dx, y - 0.34, board.z + dz]),
  );
  drawBoardShadow(scene, board, shadowPts, a);
  const top = prism(scene, {
    cx: board.x,
    cz: board.z,
    corners,
    y0: y - 0.22,
    h: 0.22,
    color: CANVAS_COLOR.group,
    alpha: a * 0.98,
    topLight: 0.035,
  });
  ctx.strokeStyle = shade(
    board.color || CANVAS_COLOR.boardFallback,
    -0.08,
    a * 0.3,
  );
  ctx.lineWidth = 1;
  facePath(scene, top);
  ctx.stroke();
  if (state.zones && board.clusters.length > 1 && cam.zoom > 0.45) {
    ctx.strokeStyle = shade(
      board.color || CANVAS_COLOR.boardFallback,
      -0.1,
      a * 0.18,
    );
    ctx.lineWidth = 1;
    for (const cluster of board.clusters) {
      const pts = roundedRectCorners(
        cluster.w + 0.7,
        cluster.d + 0.7,
        0.35,
        4,
      ).map(([dx, dz]) =>
        proj(scene, [
          board.x + cluster.x + dx,
          y + 0.01,
          board.z + cluster.z + dz,
        ]),
      );
      facePath(scene, pts);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = a;
  drawDeckTitle(scene, board);
  ctx.globalAlpha = 1;
};

export const drawBoardLabels = (
  scene: Scene,
  state: EngineState,
  board: Board,
): void => {
  const { ctx, cam } = scene;
  if (board.alpha <= 0.05) return;
  if (!state.zones || board.clusters.length <= 1 || cam.zoom <= 0.7) return;
  ctx.globalAlpha = board.alpha * 0.8;
  for (const cluster of board.clusters) {
    if (cluster.key === "all" || cluster.key === "other") continue;
    isoText(scene, {
      text: cluster.key,
      wx: board.x + cluster.x - cluster.w / 2 + 0.2,
      wy: board.y + 0.02,
      wz: board.z + cluster.z + cluster.d / 2 + 0.45,
      size: 0.4,
      color: CANVAS_COLOR.shadow,
    });
  }
  ctx.globalAlpha = 1;
};

// Faint ground grid spanning all boards.
export const drawGrid = (scene: Scene, boards: readonly Board[]): void => {
  if (boards.length === 0) return;
  const { ctx } = scene;
  let minX = 1e9;
  let maxX = -1e9;
  let minZ = 1e9;
  let maxZ = -1e9;
  for (const b of boards) {
    minX = Math.min(minX, b.x - b.w / 2);
    maxX = Math.max(maxX, b.x + b.w / 2);
    minZ = Math.min(minZ, b.z - b.d / 2);
    maxZ = Math.max(maxZ, b.z + b.d / 2);
  }
  const pad = 9;
  const step = GROUND_GRID_STEP;
  const y = -1.1;
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;
  ctx.strokeStyle = CANVAS_COLOR.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(minX / step) * step; x <= maxX; x += step) {
    const a = proj(scene, [x, y, minZ]);
    const b = proj(scene, [x, y, maxZ]);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  for (let z = Math.floor(minZ / step) * step; z <= maxZ; z += step) {
    const a = proj(scene, [minX, y, z]);
    const b = proj(scene, [maxX, y, z]);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
};
