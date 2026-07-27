import type { ExplorerEdge, ExplorerNode } from "../types/explorer";
import type { Engine } from "./engine";

export interface GestureEvents {
  onHoverNode(node: ExplorerNode | null, at: [number, number]): void;
  onHoverEdge(edge: ExplorerEdge | null, at: [number, number]): void;
  onSelectNode(node: ExplorerNode): void;
  onSelectEdge(edge: ExplorerEdge): void;
  onClear(): void;
}

interface PointerRecord {
  x: number;
  y: number;
}

type Gesture =
  | { type: "pan" | "rotate"; }
  | {
    type: "pinch";
    dist: number;
    angle: number;
    mid: { x: number; y: number; };
  };

const DRAG_THRESHOLD = 6;
const FLING_MIN_SPEED = 260;
const FLING_MAX_SPEED = 3200;

// Google-maps style camera gestures: 1:1 drag pan with fling momentum,
// modifier/right drag rotate, two-pointer pinch/rotate, wheel tilt + rotate,
// ctrl/meta wheel zoom, Safari GestureEvent pinch/twist, dblclick zoom.
export class GestureController {
  private readonly engine: Engine;
  private readonly canvas: HTMLCanvasElement;
  private readonly events: GestureEvents;
  private readonly pointers = new Map<number, PointerRecord>();
  private gesture: Gesture | null = null;
  private moved = 0;
  private safariGesture = false;
  private readonly aborter = new AbortController();

  constructor(
    canvas: HTMLCanvasElement,
    engine: Engine,
    events: GestureEvents,
  ) {
    this.canvas = canvas;
    this.engine = engine;
    this.events = events;
    this.bind();
  }

  dispose(): void {
    this.aborter.abort();
  }

  get pointerCount(): number {
    return this.pointers.size;
  }

  private bind(): void {
    const { canvas } = this;
    const opts = { signal: this.aborter.signal };
    const passive = { signal: this.aborter.signal, passive: false };
    const capture = {
      signal: this.aborter.signal,
      passive: false,
      capture: true,
    };
    canvas.addEventListener("pointerdown", (e) => this.pointerDown(e), opts);
    canvas.addEventListener("pointermove", (e) => this.pointerMove(e), opts);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), opts);
    canvas.addEventListener("dblclick", (e) => this.doubleClick(e), opts);
    // globalThis lacks the WindowEventMap overloads, so narrow explicitly.
    globalThis.addEventListener(
      "pointerup",
      (e) => this.pointerEnd(e as PointerEvent),
      opts,
    );
    globalThis.addEventListener(
      "pointercancel",
      (e) => this.pointerEnd(e as PointerEvent),
      opts,
    );
    window.addEventListener("wheel", (e) => this.wheel(e), capture);
    this.bindSafariGestures(passive);
  }

  private bindSafariGestures(opts: AddEventListenerOptions): void {
    if ((globalThis as { GestureEvent?: unknown; }).GestureEvent
      === undefined) return;
    let gAz = 0;
    let gZoom = 1;
    let twisting = false;
    type SafariGesture = Event & {
      scale: number;
      rotation: number;
      clientX: number;
      clientY: number;
    };
    addEventListener("gesturestart", (e) => {
      e.preventDefault();
      this.safariGesture = true;
      twisting = false;
      gAz = this.engine.scene.cam.tAz;
      gZoom = this.engine.scene.cam.tZoom;
    }, opts);
    addEventListener("gesturechange", (e) => {
      e.preventDefault();
      const g = e as SafariGesture;
      const cam = this.engine.scene.cam;
      this.engine.zoomBy((gZoom * g.scale) / cam.tZoom, [g.clientX, g.clientY]);
      if (!twisting && Math.abs(g.rotation) > 5) twisting = true;
      if (twisting) {
        this.engine.rotateBy(
          gAz - (g.rotation * Math.PI) / 180 - cam.tAz,
          [g.clientX, g.clientY],
        );
      }
    }, opts);
    addEventListener("gestureend", (e) => {
      e.preventDefault();
      this.safariGesture = false;
    }, opts);
  }

  private twoPointerState(): Gesture {
    const [p1, p2] = [...this.pointers.values()];
    if (!p1 || !p2) return { type: "pan" };
    return {
      type: "pinch",
      dist: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
      angle: Math.atan2(p2.y - p1.y, p2.x - p1.x),
      mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    };
  }

  private pointerDown(e: PointerEvent): void {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is best-effort.
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const mom = this.engine.mom;
    mom.active = false;
    mom.trail.length = 0;
    this.moved = 0;
    this.gesture = this.pointers.size === 2 ? this.twoPointerState() : {
      type: e.shiftKey || e.ctrlKey || e.metaKey || e.button === 2
        ? "rotate"
        : "pan",
    };
    this.canvas.classList.add(
      this.gesture.type === "rotate" ? "rotating" : "dragging",
    );
  }

  private hover(e: PointerEvent): void {
    const node = this.engine.pick(e.clientX, e.clientY);
    const edge = node ? null : this.engine.pickEdge(e.clientX, e.clientY);
    if (node) this.events.onHoverNode(node, [e.clientX, e.clientY]);
    else if (edge) this.events.onHoverEdge(edge, [e.clientX, e.clientY]);
    else {
      this.events.onHoverNode(null, [e.clientX, e.clientY]);
      this.events.onHoverEdge(null, [e.clientX, e.clientY]);
    }
  }

  private pointerMove(e: PointerEvent): void {
    const pt = this.pointers.get(e.pointerId);
    if (!pt) {
      this.hover(e);
      return;
    }
    const dx = e.clientX - pt.x;
    const dy = e.clientY - pt.y;
    pt.x = e.clientX;
    pt.y = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.pointers.size === 1) this.singlePointerDrag(e, dx, dy);
    else if (this.pointers.size === 2) this.pinchDrag();
  }

  private singlePointerDrag(e: PointerEvent, dx: number, dy: number): void {
    const cam = this.engine.scene.cam;
    if (this.gesture?.type === "pan") {
      cam.tPanX += dx;
      cam.tPanY += dy;
      cam.panX = cam.tPanX;
      cam.panY = cam.tPanY;
      const mom = this.engine.mom;
      mom.trail.push({ t: performance.now(), x: e.clientX, y: e.clientY });
      if (mom.trail.length > 8) mom.trail.shift();
    } else {
      this.engine.rotateBy(
        dx * 0.006,
        [this.engine.scene.view.w / 2, this.engine.scene.view.h / 2],
        true,
      );
    }
  }

  private pinchDrag(): void {
    if (this.gesture?.type !== "pinch") return;
    const next = this.twoPointerState();
    if (next.type !== "pinch") return;
    const cam = this.engine.scene.cam;
    this.engine.zoomBy(next.dist / this.gesture.dist, [next.mid.x, next.mid.y]);
    this.engine.rotateBy(next.angle - this.gesture.angle, [
      next.mid.x,
      next.mid.y,
    ]);
    cam.tPanX += next.mid.x - this.gesture.mid.x;
    cam.tPanY += next.mid.y - this.gesture.mid.y;
    this.gesture = next;
  }

  private pointerEnd(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 1) {
      this.gesture = { type: "pan" };
      this.engine.mom.trail.length = 0;
      return;
    }
    if (this.pointers.size > 0) return;
    this.canvas.classList.remove("dragging", "rotating");
    const wasPan = this.gesture?.type === "pan";
    const wasDrag = this.moved > DRAG_THRESHOLD;
    this.gesture = null;
    if (wasPan && wasDrag) this.fling();
    if (!wasDrag && e.target === this.canvas) this.click(e);
  }

  private fling(): void {
    const mom = this.engine.mom;
    if (mom.trail.length < 2) return;
    const now = performance.now();
    const recent = mom.trail.filter((s) => now - s.t < 110);
    if (recent.length < 2) return;
    const a = recent[0];
    const b = recent.at(-1);
    if (!a || !b) return;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0.008) return;
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed <= FLING_MIN_SPEED) return;
    const capped = Math.min(speed, FLING_MAX_SPEED) / speed;
    mom.vx = vx * capped;
    mom.vy = vy * capped;
    mom.active = true;
  }

  private click(e: PointerEvent): void {
    const node = this.engine.pick(e.clientX, e.clientY);
    if (node) {
      this.events.onSelectNode(node);
      return;
    }
    const edge = this.engine.pickEdge(e.clientX, e.clientY);
    if (edge) {
      this.events.onSelectEdge(edge);
      return;
    }
    this.events.onClear();
  }

  private doubleClick(e: MouseEvent): void {
    e.preventDefault();
    this.engine.zoomBy(e.shiftKey ? 1 / 2.2 : 2.2, [e.clientX, e.clientY]);
  }

  private overPanel(e: Event): boolean {
    const target = e.target as Element | null;
    return Boolean(
      target?.closest?.(
        "#dock,#drawer,#flowPlayer,#searchResults,pre.payload",
      ),
    );
  }

  private wheel(e: WheelEvent): void {
    if (this.safariGesture) {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.engine.zoomBy(Math.exp(-e.deltaY * 0.012), [e.clientX, e.clientY]);
      return;
    }
    if (this.overPanel(e)) return;
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.engine.rotateBy(e.deltaX * 0.0032, [e.clientX, e.clientY]);
    } else {
      const cam = this.engine.scene.cam;
      cam.tTilt = Math.min(1.45, Math.max(0.5, cam.tTilt + e.deltaY * 0.0016));
    }
  }
}
