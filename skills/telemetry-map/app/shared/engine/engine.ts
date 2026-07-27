import type {
  Board,
  ExplorerEdge,
  ExplorerNode,
  ViewMode,
} from "../types/explorer";
import type { CameraHome } from "../utils/camera";
import type { Scene } from "./scene";
import type { EngineState } from "./state";

import {
  applyZoom,
  BAKED_HOME,
  createCamera,
  easeCamera,
  heightK,
  point,
  rotateAround,
  SCALE,
} from "../utils/camera";
import { layoutView, nodeHeight } from "../utils/layout";
import { domainColor } from "../utils/palette";
import { drawBoard, drawBoardLabels, drawGrid } from "./boards";
import { drawEdge, drawParticles, edgeCurve, newCurve } from "./edges";
import { drawFlow, stepFlowClock } from "./flow-draw";
import { visualNodeFoot } from "./nodes";
import { drawNodeShadow, drawNodeShape } from "./nodes";
import { proj, qPoint, rectCorners, roundedRectCorners } from "./scene";
import { facePath } from "./scene";
import { drawSprite, labelSprite } from "./sprites";
import { edgeVisible, focusSet, updateVisibility } from "./state";

const HOMES_STORAGE_KEY = "flowStackHomes";

export interface EngineEvents {
  onFlowAdvance(): void;
  onFlowFinished(): void;
  onFlowProgress(progress: number): void;
}

export interface Momentum {
  active: boolean;
  vx: number;
  vy: number;
  trail: { t: number; x: number; y: number; }[];
}

const loadHomes = (): Partial<Record<ViewMode, CameraHome>> => {
  try {
    return JSON.parse(
      localStorage.getItem(HOMES_STORAGE_KEY) ?? "{}",
    ) as Partial<Record<ViewMode, CameraHome>>;
  } catch {
    return {};
  }
};

// The imperative isometric renderer: owns the camera, boards, frame loop,
// and picking. Vue components drive it through the store's EngineState.
export class Engine {
  readonly state: EngineState;
  readonly scene: Scene;
  readonly mom: Momentum = { active: false, vx: 0, vy: 0, trail: [] };
  readonly events: EngineEvents;
  readonly reducedMotion: boolean;
  private readonly homes = loadHomes();
  private readonly drawList: ExplorerNode[] = [];
  private lastT = 0;
  private booted = 0;
  private rafId = 0;

  constructor(
    canvas: HTMLCanvasElement,
    state: EngineState,
    events: EngineEvents,
  ) {
    this.state = state;
    this.events = events;
    const home = this.homeFor("domains");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("telemetry-map: 2d context unavailable");
    this.scene = {
      ctx,
      cam: createCamera(home),
      view: { w: 0, h: 0 },
      dpr: 1,
    };
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize(canvas);
  }

  homeFor(view: ViewMode): CameraHome {
    return this.homes[view] ?? BAKED_HOME[view];
  }

  resize(canvas: HTMLCanvasElement): void {
    const { scene } = this;
    scene.dpr = Math.min(devicePixelRatio || 1, 2);
    scene.view.w = innerWidth;
    scene.view.h = innerHeight;
    canvas.width = scene.view.w * scene.dpr;
    canvas.height = scene.view.h * scene.dpr;
    canvas.style.width = `${scene.view.w}px`;
    canvas.style.height = `${scene.view.h}px`;
  }

  start(): void {
    this.booted = performance.now();
    this.lastT = this.booted;
    const frame = (now: number): void => {
      this.rafId = requestAnimationFrame(frame);
      this.frame(now);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  applyView(mode: ViewMode, first: boolean): void {
    const { state } = this;
    state.viewMode = mode;
    state.boards = layoutView(mode, state.pack, [...state.pack.nodes]);
    for (const node of state.pack.nodes) {
      const board = state.boards.find((b) =>
        b.clusters.some((cluster) => cluster.nodes.includes(node))
      );
      if (!board) {
        node.board = null;
        node.rs.visible = false;
        continue;
      }
      node.board = board;
      node.rs.tx = board.x + (node.lx ?? 0);
      node.rs.ty = board.y;
      node.rs.tz = board.z + (node.lz ?? 0);
      if (first) {
        node.rs.x = node.rs.tx;
        node.rs.y = node.rs.ty - 14;
        node.rs.z = node.rs.tz;
      }
    }
    for (const board of state.boards) {
      board.alpha = 0;
      board.tAlpha = 1;
    }
    updateVisibility(state);
  }

  sceneYMid(): number {
    const { boards } = this.state;
    if (boards.length === 0) return 0;
    let min = 1e9;
    let max = -1e9;
    for (const board of boards) {
      min = Math.min(min, board.y);
      max = Math.max(max, board.y);
    }
    return (min + max) / 2;
  }

  zoomBy(factor: number, anchor?: readonly [number, number]): void {
    applyZoom(this.scene.cam, this.scene.view, factor, anchor);
    this.mom.active = false;
  }

  rotateBy(dAz: number, anchor: readonly [number, number], snap = false): void {
    rotateAround(this.scene.cam, this.scene.view, {
      dAz,
      cx: anchor[0],
      cy: anchor[1],
      yRef: this.sceneYMid(),
      snap,
    });
    this.mom.active = false;
  }

  resetView(): void {
    const home = this.homeFor(this.state.viewMode);
    const cam = this.scene.cam;
    cam.tAz = home.az;
    cam.tTilt = home.tilt;
    if (home.zoom === undefined) {
      this.fitView();
    } else {
      cam.tZoom = home.zoom;
      cam.tPanX = home.panX ?? 0;
      cam.tPanY = home.panY ?? 0;
      this.mom.active = false;
    }
  }

  // Fit visible boards inside the viewport margins at the target azimuth.
  fitView(): void {
    const { state, scene } = this;
    if (state.boards.length === 0) return;
    const cam = scene.cam;
    const saved = {
      az: cam.az,
      zoom: cam.zoom,
      panX: cam.panX,
      panY: cam.panY,
    };
    cam.az = cam.tAz;
    cam.zoom = 1;
    cam.panX = 0;
    cam.panY = 0;
    let minX = 1e9;
    let maxX = -1e9;
    let minY = 1e9;
    let maxY = -1e9;
    const p = point();
    for (const board of state.boards) {
      if (state.boardOff.has(board.id)) continue;
      for (const [dx, dz] of rectCorners(board.w, board.d)) {
        for (const dy of [-1, 4.2]) {
          proj(scene, [board.x + dx, board.y + dy, board.z + dz], p);
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
    }
    cam.az = saved.az;
    cam.zoom = saved.zoom;
    cam.panX = saved.panX;
    cam.panY = saved.panY;
    const mL = 60;
    const mR = 310;
    const mT = 130;
    const mB = 90;
    const w = scene.view.w;
    const h = scene.view.h;
    const z = Math.min((w - mL - mR) / (maxX - minX), (h - mT - mB) / (maxY - minY));
    // The stair-stepped Stack view spreads wider than the old aligned
    // stack, so it takes a gentler boost to stay fully inside the margins.
    const fitBoost = w < 900
      ? (state.viewMode === "layers" ? 1 : 1.16)
      : (state.viewMode === "layers" ? 1.12 : 1.68);
    cam.tZoom = Math.min(1.7, Math.max(0.22, z * fitBoost));
    const cx = (minX + maxX) / 2 - w / 2;
    const cy = (minY + maxY) / 2 - h / 2;
    cam.tPanX = (mL + (w - mR)) / 2 - w / 2 - cx * cam.tZoom;
    cam.tPanY = (mT + (h - mB)) / 2 - h / 2 - cy * cam.tZoom;
    this.mom.active = false;
  }

  // Zoom to at least 1.25 and center the given node at target pose.
  focusNode(node: ExplorerNode): void {
    const cam = this.scene.cam;
    cam.tZoom = Math.max(cam.tZoom, 1.25);
    const c = Math.cos(cam.tAz);
    const sn = Math.sin(cam.tAz);
    const rx = node.rs.tx * c - node.rs.tz * sn;
    const rz = node.rs.tx * sn + node.rs.tz * c;
    cam.tPanX = -(rx - rz) * 0.866 * SCALE * cam.tZoom;
    cam.tPanY = -((rx + rz) * (0.5 * cam.tTilt)
      - node.rs.ty * heightK(cam.tTilt)) * SCALE * cam.tZoom + 40;
    this.mom.active = false;
  }

  pick(mx: number, my: number): ExplorerNode | null {
    const cam = this.scene.cam;
    let best: ExplorerNode | null = null;
    let bestD = -1e9;
    for (const node of this.drawList) {
      const hk = nodeHeight() * heightK(cam.tilt) * SCALE * cam.zoom * 0.5;
      const dx = mx - node.rs.sx;
      const dy = my - (node.rs.sy - hk);
      const rx = node.rs.r;
      const ry = node.rs.r * 0.75 + hk;
      if (Math.abs(dx) < rx && Math.abs(dy) < ry && node.rs.depth > bestD) {
        bestD = node.rs.depth;
        best = node;
      }
    }
    return best;
  }

  pickEdge(mx: number, my: number): ExplorerEdge | null {
    const { state } = this;
    if (state.edgeBrightness === "off" && !state.flow) return null;
    let best: ExplorerEdge | null = null;
    let bestDist = 8;
    const curve = newCurve();
    const p = point();
    for (const edge of state.pack.edges) {
      if (!edgeVisible(state, edge)) continue;
      edgeCurve(this.scene, state, edge, curve);
      for (let i = 0; i <= 14; i++) {
        qPoint(curve.a, curve.c, curve.b, i / 14, p);
        const d = Math.hypot(mx - p.x, my - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = edge;
        }
      }
    }
    return best;
  }

  private tween(dt: number): void {
    const { state, scene, mom } = this;
    easeCamera(scene.cam, dt);
    if (mom.active) {
      scene.cam.tPanX += mom.vx * dt;
      scene.cam.tPanY += mom.vy * dt;
      scene.cam.panX = scene.cam.tPanX;
      scene.cam.panY = scene.cam.tPanY;
      const fr = Math.exp(-dt * 3.4);
      mom.vx *= fr;
      mom.vy *= fr;
      if (Math.hypot(mom.vx, mom.vy) < 24) mom.active = false;
    }
    for (const node of state.pack.nodes) {
      const r = node.rs;
      const k = Math.min(1, dt * 6.5);
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
      r.z += (r.tz - r.z) * k;
    }
    for (const board of state.boards) {
      board.alpha += (board.tAlpha - board.alpha) * Math.min(1, dt * 5);
    }
  }

  private projectNodes(): void {
    const { state, scene } = this;
    this.drawList.length = 0;
    const p = point();
    for (const node of state.pack.nodes) {
      if (!node.rs.visible) continue;
      proj(scene, [node.rs.x, node.rs.y, node.rs.z], p);
      node.rs.sx = p.x;
      node.rs.sy = p.y;
      node.rs.depth = p.d;
      node.rs.r = visualNodeFoot(node) * SCALE * scene.cam.zoom * 0.75;
      this.drawList.push(node);
    }
  }

  private drawBoards(age: number, focus: Set<string> | null): Board[] {
    const { state, scene } = this;
    const p = point();
    const sorted = state.boards.filter((b) => !state.boardOff.has(b.id));
    for (const board of sorted) {
      proj(scene, [board.x, board.y, board.z], p);
      board.depth = p.d;
    }
    sorted.sort((a, b) => a.y - b.y || (a.depth ?? 0) - (b.depth ?? 0));
    for (const board of sorted) {
      drawBoard(scene, state, board);
      const nodes = this.drawList
        .filter((node) => node.board === board)
        .sort((a, b) => a.rs.depth - b.rs.depth);
      for (const node of nodes) {
        const off = node.rs.sx < -90 || node.rs.sx > scene.view.w + 90
          || node.rs.sy < -140 || node.rs.sy > scene.view.h + 140;
        if (off) {
          node.rs.paintAlpha = 0;
          continue;
        }
        const inFocus = focus ? focus.has(node.id) : true;
        const born = Math.min(1, Math.max(0, (age - node.rs.birth) * 2.2));
        const pop = 1 - Math.pow(1 - born, 3);
        node.rs.paintAlpha = (inFocus ? 1 : 0.14) * pop;
        drawNodeShadow(scene, node, node.rs.paintAlpha);
      }
      for (const node of nodes) {
        if (node.rs.paintAlpha <= 0.01) continue;
        const hot = node === state.hovered || node === state.selected;
        drawNodeShape(scene, node, { alpha: node.rs.paintAlpha, hot });
        if (hot) this.drawSelectionRing(node);
      }
    }
    return sorted;
  }

  private drawSelectionRing(node: ExplorerNode): void {
    const { scene } = this;
    const { ctx } = scene;
    const foot = visualNodeFoot(node);
    const pts = roundedRectCorners(
      foot * 1.12 * 1.2,
      foot * 0.72 * 1.28,
      foot * 0.14,
      4,
    ).map(([dx, dz]) =>
      proj(scene, [node.rs.x + dx, node.rs.y + 0.02, node.rs.z + dz])
    );
    ctx.save();
    ctx.strokeStyle = domainColor(node);
    ctx.lineWidth = 2;
    ctx.shadowColor = domainColor(node);
    ctx.shadowBlur = 12;
    facePath(scene, pts);
    ctx.stroke();
    ctx.restore();
  }

  private drawLabels(sorted: readonly Board[], focus: Set<string> | null): void {
    const { state, scene } = this;
    if (!state.labels) return;
    const zoomK = scene.cam.zoom;
    for (const node of this.drawList) {
      // Every node carries visual.size "m" (rank 1), so of the legacy rank
      // thresholds only the zoom > 1.2 branch can fire.
      const focused = focus ? focus.has(node.id) : true;
      const show = node === state.hovered || node === state.selected
        || (focused && zoomK > 1.2);
      if (!show) continue;
      const k = Math.min(0.72, Math.max(0.5, zoomK * 0.48));
      const yTop = proj(scene, [
        node.rs.x,
        node.rs.y + nodeHeight() + 0.95,
        node.rs.z,
      ]);
      scene.ctx.globalAlpha = focused ? 1 : 0.25;
      drawSprite(scene, labelSprite(node.name, "node"), [yTop.x, yTop.y, k]);
      scene.ctx.globalAlpha = 1;
    }
    for (const board of sorted) drawBoardLabels(scene, state, board);
  }

  private stepFlow(dt: number): void {
    const { state } = this;
    if (!state.flow) return;
    const result = stepFlowClock(state, this.reducedMotion ? 0 : dt);
    if (result.finishedLastStep) {
      this.events.onFlowFinished();
      return;
    }
    if (result.advance) {
      this.events.onFlowAdvance();
      return;
    }
    this.events.onFlowProgress(result.progress);
    drawFlow(this.scene, state);
  }

  private frame(now: number): void {
    const { state, scene } = this;
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const age = (now - this.booted) / 1000;
    this.tween(dt);
    scene.ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
    scene.ctx.clearRect(0, 0, scene.view.w, scene.view.h);
    const focus = focusSet(state);
    this.projectNodes();
    drawGrid(scene, state.boards);
    const sorted = this.drawBoards(age, focus);
    const visEdges = state.pack.edges.filter((edge) =>
      edgeVisible(state, edge)
    );
    for (const edge of visEdges) drawEdge(scene, state, edge, focus);
    if (state.particles && !this.reducedMotion && !state.flow) {
      for (const edge of visEdges) {
        drawParticles(scene, state, edge, { dt, focus });
      }
    }
    this.stepFlow(dt);
    this.drawLabels(sorted, focus);
  }
}
