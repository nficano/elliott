import type { ViewMode } from "../types/explorer";

export const SCALE = 26; // world unit → px at zoom 1
export const YF = 0.92; // vertical exaggeration

export interface CameraState {
  az: number;
  zoom: number;
  panX: number;
  panY: number;
  tilt: number;
  tAz: number;
  tZoom: number;
  tPanX: number;
  tPanY: number;
  tTilt: number;
}

export interface CameraHome {
  az: number;
  tilt: number;
  zoom?: number;
  panX?: number;
  panY?: number;
}

// Per-view default cameras (user-tuned in the legacy explorer).
export const BAKED_HOME: Readonly<Record<ViewMode, CameraHome>> = {
  domains: { az: (-18.2 * Math.PI) / 180, tilt: 1.08 },
  deploy: { az: (-18.2 * Math.PI) / 180, tilt: 1.08 },
  layers: { az: (-38 * Math.PI) / 180, tilt: 0.86 },
};

export const createCamera = (home: CameraHome): CameraState => ({
  az: home.az,
  zoom: 1,
  panX: 0,
  panY: 40,
  tilt: home.tilt,
  tAz: home.az,
  tZoom: 1,
  tPanX: 0,
  tPanY: 40,
  tTilt: home.tilt,
});

export const depthK = (tilt: number): number => 0.5 * tilt;

export const heightK = (tilt: number): number => YF * (1.45 - 0.45 * tilt);

export interface Projected {
  x: number;
  y: number;
  d: number;
}

export const point = (): Projected => ({ x: 0, y: 0, d: 0 });

export interface Viewport {
  w: number;
  h: number;
}

// Project a world point through the isometric camera into screen space.
export const project = (
  cam: CameraState,
  view: Viewport,
  world: readonly [number, number, number],
  out: Projected,
): Projected => {
  const [x, y, z] = world;
  const c = Math.cos(cam.az);
  const s = Math.sin(cam.az);
  const rx = x * c - z * s;
  const rz = x * s + z * c;
  out.x = (rx - rz) * 0.866 * SCALE * cam.zoom + view.w / 2 + cam.panX;
  out.y = ((rx + rz) * depthK(cam.tilt) - y * heightK(cam.tilt)) * SCALE
      * cam.zoom + view.h / 2 + cam.panY;
  out.d = rx + rz;
  return out;
};

// Invert the target-space projection at a screen point onto the plane y=yRef.
export const screenToWorld = (
  cam: CameraState,
  view: Viewport,
  screen: readonly [number, number],
  yRef: number,
): { x: number; z: number; } => {
  const [sx, sy] = screen;
  const a = (sx - view.w / 2 - cam.tPanX) / (0.866 * SCALE * cam.tZoom);
  const b = ((sy - view.h / 2 - cam.tPanY) / (SCALE * cam.tZoom)
    + yRef * heightK(cam.tTilt)) / depthK(cam.tTilt);
  const rx = (b + a) / 2;
  const rz = (b - a) / 2;
  const c = Math.cos(cam.tAz);
  const sn = Math.sin(cam.tAz);
  return { x: rx * c + rz * sn, z: -rx * sn + rz * c };
};

const MIN_ZOOM = 0.22;
const MAX_ZOOM = 3.6;

// Zoom toward a screen anchor, keeping the anchored world point fixed.
export const applyZoom = (
  cam: CameraState,
  view: Viewport,
  factor: number,
  anchor?: readonly [number, number],
): void => {
  const [cx, cy] = anchor ?? [view.w / 2, view.h / 2];
  const z0 = cam.tZoom;
  const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z0 * factor));
  const k = z1 / z0;
  cam.tPanX = cx - view.w / 2 - (cx - view.w / 2 - cam.tPanX) * k;
  cam.tPanY = cy - view.h / 2 - (cy - view.h / 2 - cam.tPanY) * k;
  cam.tZoom = z1;
};

// Rotate the world about the point currently under the anchor; snap keeps the
// 1:1 drag feel by committing the target pose immediately.
export const rotateAround = (
  cam: CameraState,
  view: Viewport,
  input: { dAz: number; cx: number; cy: number; yRef: number; snap?: boolean; },
): void => {
  const pW = screenToWorld(cam, view, [input.cx, input.cy], input.yRef);
  cam.tAz += input.dAz;
  const c = Math.cos(cam.tAz);
  const sn = Math.sin(cam.tAz);
  const rx = pW.x * c - pW.z * sn;
  const rz = pW.x * sn + pW.z * c;
  cam.tPanX = input.cx - view.w / 2 - (rx - rz) * 0.866 * SCALE * cam.tZoom;
  cam.tPanY = input.cy - view.h / 2
    - ((rx + rz) * depthK(cam.tTilt) - input.yRef * heightK(cam.tTilt)) * SCALE
      * cam.tZoom;
  if (input.snap === true) {
    cam.az = cam.tAz;
    cam.panX = cam.tPanX;
    cam.panY = cam.tPanY;
  }
};

// Ease the live camera toward its targets; returns the smoothing factor used.
export const easeCamera = (cam: CameraState, dt: number): number => {
  const k = Math.min(1, dt * 11);
  cam.az += (cam.tAz - cam.az) * k;
  cam.zoom += (cam.tZoom - cam.zoom) * k;
  cam.tilt += (cam.tTilt - cam.tilt) * k;
  cam.panX += (cam.tPanX - cam.panX) * k;
  cam.panY += (cam.tPanY - cam.panY) * k;
  return k;
};
