<template>
  <canvas
    id="scene"
    ref="canvasRef"
    aria-label="Interactive Elliott runtime topology. Switch views, send a message to trace its runtime path, or select a node or connection for details."
    class="fixed inset-0 block cursor-grab touch-none"
    role="img"
  />
</template>

<script setup lang="ts">
import { Engine } from "#shared/engine/engine";
import { GestureController } from "#shared/engine/gestures";
import { bindFontReload } from "#shared/engine/sprites";

import {
  clearSelection,
  exitFlow,
  flowAdvance,
  flowFinished,
  flowProgress,
  flowTogglePlay,
  selectEdge,
  selectNode,
  useExplorer,
} from "~/composables/useExplorer";

const explorer = useExplorer();
const canvasRef = ref<HTMLCanvasElement | null>(null);
let engine: Engine | undefined;
let gestures: GestureController | undefined;

const HOVER_TOOLTIP_DELAY_MS = 850;
let tooltipTimer: ReturnType<typeof setTimeout> | undefined;

type HoveredNode = typeof explorer.hover.value.node;
type HoveredEdge = typeof explorer.hover.value.edge;

const hoverCursor = (hot: boolean): string => {
  if (hot) return "pointer";
  return gestures?.pointerCount ? "grabbing" : "grab";
};

const scheduleTooltip = (node: HoveredNode, edge: HoveredEdge): void => {
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => {
    const current = explorer.hover.value;
    if (current.node === node && current.edge === edge) {
      explorer.hover.value = { ...current, shown: true };
    }
  }, HOVER_TOOLTIP_DELAY_MS);
};

const setHover = (
  node: HoveredNode,
  edge: HoveredEdge,
  at: [number, number],
): void => {
  const state = explorer.engineState.value;
  const canvas = canvasRef.value;
  if (!state || !canvas) return;
  const changed = state.hovered !== node || state.hoveredEdge !== edge;
  state.hovered = node;
  state.hoveredEdge = edge;
  explorer.hover.value = {
    node,
    edge,
    x: at[0],
    y: at[1],
    shown: !changed && explorer.hover.value.shown,
  };
  canvas.style.cursor = hoverCursor(Boolean(node ?? edge));
  if ((node ?? edge) && changed) scheduleTooltip(node, edge);
};

const isFormField = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement
  && target.matches("input, textarea, select, [contenteditable='true']");

const flowKey = (e: KeyboardEvent): boolean => {
  const state = explorer.engineState.value;
  if (!state?.flow) return false;
  if (e.key === "ArrowLeft") {
    flowAdvance(-1);
    return true;
  }
  if (e.key === "ArrowRight") {
    flowAdvance(1);
    return true;
  }
  if (e.key === " ") {
    e.preventDefault();
    flowTogglePlay();
    return true;
  }
  if (e.key === "Escape") {
    exitFlow();
    return true;
  }
  return false;
};

const KEY_ZOOM_FACTOR = 1.25;
const PAN_STEP = 80;
const PAN_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [PAN_STEP, 0],
  ArrowRight: [-PAN_STEP, 0],
  ArrowUp: [0, PAN_STEP],
  ArrowDown: [0, -PAN_STEP],
};

const cameraKey = (e: KeyboardEvent): void => {
  const cam = engine?.scene.cam;
  if (!engine || !cam) return;
  if (e.key === "+" || e.key === "=") {
    engine.zoomBy(KEY_ZOOM_FACTOR);
    return;
  }
  if (e.key === "-") {
    engine.zoomBy(1 / KEY_ZOOM_FACTOR);
    return;
  }
  if (e.key === "Escape") {
    clearSelection();
    return;
  }
  const pan = PAN_KEYS[e.key];
  if (pan) {
    cam.tPanX += pan[0];
    cam.tPanY += pan[1];
  }
};

const onKeydown = (e: KeyboardEvent): void => {
  if (isFormField(e.target)) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  if (flowKey(e)) return;
  cameraKey(e);
};

const onResize = (): void => {
  if (canvasRef.value && engine) engine.resize(canvasRef.value);
};

onMounted(() => {
  const canvas = canvasRef.value;
  const state = explorer.engineState.value;
  if (!canvas || !state) return;
  bindFontReload();
  engine = new Engine(canvas, state, {
    onFlowAdvance: () => flowAdvance(1),
    onFlowFinished: flowFinished,
    onFlowProgress: flowProgress,
  });
  explorer.engine.value = engine;
  // Debug handle, same affordance as the legacy explorer.
  (globalThis as { __cam?: unknown; }).__cam = engine.scene.cam;
  gestures = new GestureController(canvas, engine, {
    onHoverNode: (node, at) => setHover(node, null, at),
    onHoverEdge: (edge, at) => setHover(null, edge, at),
    onSelectNode: selectNode,
    onSelectEdge: selectEdge,
    onClear: clearSelection,
  });
  engine.applyView("domains", true);
  engine.resetView();
  // Boot intro: start pulled back and low so the eased camera settles in.
  const BOOT_ZOOM_K = 0.72;
  const BOOT_PAN_LIFT = 30;
  const cam = engine.scene.cam;
  cam.zoom = cam.tZoom * BOOT_ZOOM_K;
  cam.panX = cam.tPanX;
  cam.panY = cam.tPanY + BOOT_PAN_LIFT;
  engine.start();
  addEventListener("resize", onResize);
  addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  removeEventListener("resize", onResize);
  removeEventListener("keydown", onKeydown);
  clearTimeout(tooltipTimer);
  gestures?.dispose();
  engine?.stop();
  explorer.engine.value = null;
});
</script>

<style scoped>
#scene.dragging {
  cursor: grabbing;
}
#scene.rotating {
  cursor: ew-resize;
}
</style>
