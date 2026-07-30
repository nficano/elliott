<template>
  <div>
    <ExplorerScene v-if="explorer.status.value === 'ready'" />
    <TitleHud :subtitle="explorer.subtitle.value" />
    <template v-if="explorer.status.value === 'ready'">
      <div id="dock" class="hud">
        <ViewSwitcher
          :model-value="explorer.viewMode.value"
          @update:model-value="setView"
        />
        <SendPanel />
        <InvocationsCard
          :invocations="explorer.invocations.value"
          @replay="replay"
        />
        <EdgeBrightnessControl
          :flow-active="explorer.flowUi.value.active"
          :model-value="explorer.edgeBrightness.value"
          @update:model-value="setEdgeBrightness"
        />
      </div>
      <NavControls
        @reset="engineAction((engine) => engine.resetView())"
        @rotate="rotate"
        @zoom="zoom"
      />
      <HintBar />
      <NodeTooltip :hover="explorer.hover.value" />
      <DetailDrawer
        :edge="explorer.selectedEdge.value"
        :node="explorer.selectedNode.value"
        :open="explorer.drawerOpen.value"
        :trace="traceStep"
        :trace-run-id="explorer.trace.value?.runId"
        @close="closeDrawer"
        @select-edge="selectEdge"
        @select-node="selectNodeById"
      />
      <FlowPlayer
        :flow="explorer.activeFlow.value"
        :flow-ui="explorer.flowUi.value"
        @advance="flowAdvance"
        @exit="exitFlow"
        @pause="flowPause"
        @toggle-play="flowTogglePlay"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Engine } from "#shared/engine/engine";

import {
  clearSelection,
  exitFlow,
  flowAdvance,
  flowPause,
  flowTogglePlay,
  loadExplorer,
  selectEdge,
  selectNode,
  setEdgeBrightness,
  setView,
  useExplorer,
} from "~/composables/useExplorer";
import {
  seedInvocations,
  startLiveTelemetry,
  stopLiveTelemetry,
} from "~/composables/useLiveTelemetry";
import { startTraceReplay } from "~/composables/useTraceReplay";

const explorer = useExplorer();

const traceStep = computed(() => {
  const trace = explorer.trace.value;
  if (!trace) return null;
  return trace.steps[explorer.flowUi.value.stepIndex] ?? null;
});

const replay = (runId: string): void => {
  void startTraceReplay(runId);
};

// Closing the trace inspector ends the replay; otherwise it is a normal
// selection clear.
const closeDrawer = (): void => {
  if (explorer.trace.value) exitFlow();
  else clearSelection();
};

const engineAction = (action: (engine: Engine) => void): void => {
  const engine = explorer.engine.value;
  if (engine) action(engine);
};

const ROTATE_STEP_DIVISOR = 6;
const ROTATE_STEP = Math.PI / ROTATE_STEP_DIVISOR;

const zoom = (factor: number): void => {
  engineAction((engine) => engine.zoomBy(factor));
};

const rotate = (direction: number): void => {
  engineAction((engine) =>
    engine.rotateBy(direction * ROTATE_STEP, [
      engine.scene.view.w / 2,
      engine.scene.view.h / 2,
    ])
  );
};

const selectNodeById = (nodeId: string): void => {
  const state = explorer.engineState.value;
  const node = state?.nodesById.get(nodeId);
  if (!node) return;
  selectNode(node);
  engineAction((engine) => engine.focusNode(node));
};

onMounted(async () => {
  await loadExplorer();
  await seedInvocations();
  startLiveTelemetry();
});

onBeforeUnmount(stopLiveTelemetry);
</script>

<style scoped>
#dock {
  position: fixed;
  top: 18px;
  right: 18px;
  width: 252px;
  max-height: calc(100vh - 120px);
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2xs);
  overflow: hidden auto;
  scrollbar-width: thin;
  padding-bottom: var(--spacing-3xs);
  opacity: 0.82;
  transition: opacity 0.3s var(--ease-out-map);
}
#dock:hover,
#dock:focus-within {
  opacity: 1;
}
@media (max-width: 900px) {
  #dock {
    top: 72px;
    left: var(--spacing-sm);
    right: var(--spacing-sm);
    width: auto;
    max-height: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--spacing-3xs);
    overflow: visible;
    opacity: 1;
    padding: 0;
  }
  #dock > :first-child,
  #dock > :nth-child(2),
  #dock > :nth-child(3) {
    grid-column: 1 / -1;
    min-width: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  #dock {
    opacity: 1;
  }
}
</style>
