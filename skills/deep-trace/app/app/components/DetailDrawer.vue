<template>
  <div
    id="drawer"
    :aria-hidden="!open"
    aria-labelledby="dName"
    class="hud fixed bottom-0 left-0 top-0 z-20 w-[352px] pb-sm pl-sm pr-xs pt-sm max-[900px]:w-[min(340px,92vw)]"
    :class="{ open }"
    :data-kind="kind"
    :inert="!open"
    role="region"
  >
    <div
      id="drawerCard"
      class="shadow-drawer-map flex h-full flex-col overflow-hidden rounded-[16px] border border-line bg-panel-strong"
    >
      <div id="drawerHead" class="relative border-b border-line-soft px-sm pb-xs pt-sm">
        <div class="mb-3xs flex items-center gap-2xs">
          <i
            id="dDot"
            class="h-[10px] w-[10px] rounded-[3px] border border-ink-soft not-italic"
            :style="{ background: dotColor }"
          />
          <span
            id="dKicker"
            class="text-[9.5px] font-extrabold uppercase tracking-[0.09em] text-ink-soft"
          >{{ kicker }}</span>
        </div>
        <h3
          id="dName"
          class="font-display text-[19px] font-bold leading-[1.2] tracking-[-0.02em]"
        >
          {{ name }}
        </h3>
        <div id="dId" class="mt-3xs font-code text-[10px] text-ink-soft">
          {{ id }}
        </div>
        <button
          id="drawerClose"
          ref="closeRef"
          :aria-label="`Close ${kind} details`"
          class="absolute right-[10px] top-[10px] h-[26px] w-[26px] cursor-pointer rounded-[8px] border-0 bg-surface-quiet text-[13px] text-ink hover:bg-surface-pressed"
          type="button"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>
      <div
        id="drawerBody"
        ref="bodyRef"
        class="flex-1 overflow-auto px-sm pb-md pt-xs [scrollbar-width:thin]"
      >
        <TraceStepBody v-if="trace" :step="trace" />
        <NodeDetailBody
          v-else-if="node"
          :node="node"
          @select-edge="(edge) => emit('select-edge', edge)"
        />
        <EdgeDetailBody
          v-else-if="edge"
          :edge="edge"
          @select-node="(nodeId) => emit('select-node', nodeId)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ExplorerEdge, ExplorerNode } from "#shared/types/explorer";
import type { TraceStep } from "#shared/types/trace";

import { displayKind } from "#shared/engine/nodes";
import { CANVAS_COLOR, domainColor } from "#shared/utils/palette";

import { useExplorer } from "~/composables/useExplorer";

const props = defineProps<{
  open: boolean;
  node: ExplorerNode | null;
  edge: ExplorerEdge | null;
  trace?: TraceStep | null;
  traceRunId?: string | undefined;
}>();

const emit = defineEmits<{
  close: [];
  "select-edge": [edge: ExplorerEdge];
  "select-node": [nodeId: string];
}>();

const explorer = useExplorer();
const closeRef = ref<HTMLButtonElement | null>(null);
const bodyRef = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;

const kind = computed(() => {
  if (props.trace) return "trace";
  if (props.node) return "component";
  if (props.edge) return "connection";
  return "details";
});

const dotColor = computed(() => {
  if (props.trace) {
    const node = explorer.engineState.value?.nodesById.get(props.trace.nodeId);
    return node ? domainColor(node) : CANVAS_COLOR.accent;
  }
  if (props.node) return domainColor(props.node);
  if (props.edge) {
    return explorer.engineState.value?.edgeStyle.get(props.edge.kind)?.color
      ?? CANVAS_COLOR.itemFallback;
  }
  return CANVAS_COLOR.accent;
});

const kicker = computed(() => {
  if (props.trace) {
    const node = explorer.engineState.value?.nodesById.get(props.trace.nodeId);
    return `trace · ${node?.name ?? props.trace.nodeId}`;
  }
  if (props.node) {
    return `${displayKind(props.node)}${
      props.node.domain ? ` · ${props.node.domain}` : ""
    }`;
  }
  if (props.edge) return `${props.edge.kind} · ${props.edge.mode ?? ""}`;
  return "";
});

const endpointName = (id: string): string =>
  explorer.engineState.value?.nodesById.get(id)?.name ?? "?";

const name = computed(() => {
  if (props.trace) return props.trace.title;
  if (props.node) return props.node.name;
  if (props.edge) {
    return `${endpointName(props.edge.from)} → ${endpointName(props.edge.to)}`;
  }
  return "";
});

const id = computed(() => {
  if (props.trace) return props.traceRunId ?? "";
  return props.node?.id ?? props.edge?.id ?? "";
});

let wasOpen = false;

watch(() => [props.open, props.node, props.edge, props.trace] as const, ([open]) => {
  if (open) {
    const focusClose = !wasOpen;
    wasOpen = true;
    const active = document.activeElement;
    if (
      focusClose && returnFocus === null && active instanceof HTMLElement
      && active !== document.body
    ) {
      returnFocus = active;
    }
    requestAnimationFrame(() => {
      // Stepping through a trace swaps content without re-stealing focus
      // from the transport controls; only a fresh open grabs it.
      if (focusClose) closeRef.value?.focus({ preventScroll: true });
      if (bodyRef.value) bodyRef.value.scrollTop = 0;
    });
    return;
  }
  wasOpen = false;
  const target = returnFocus;
  returnFocus = null;
  if (target?.isConnected) {
    requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }
});
</script>

<style scoped>
#drawer {
  transform: translateX(-105%);
  visibility: hidden;
  transition:
    transform 0.28s cubic-bezier(0.2, 0.9, 0.25, 1),
    visibility 0s linear 0.28s;
}
#drawer.open {
  transform: translateX(0);
  visibility: visible;
  transition-delay: 0s;
}
</style>
