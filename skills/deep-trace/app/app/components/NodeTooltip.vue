<template>
  <div
    id="tooltip"
    :aria-hidden="!hover.shown"
    class="shadow-tooltip-map pointer-events-none fixed z-30 max-w-[340px] rounded-[11px] border border-line bg-paper-bright px-xs py-2xs opacity-0 transition-opacity duration-[120ms]"
    :class="{ show: hover.shown }"
    role="tooltip"
    :style="{ left: `${clampedX}px`, top: `${clampedY}px` }"
  >
    <div class="t-name text-[13px] font-bold">
      {{ name }}
    </div>
    <div
      class="t-kind mt-3xs text-[9.5px] font-bold uppercase tracking-[0.07em] text-indigo"
    >
      {{ kind }}
    </div>
    <div class="t-role mt-3xs text-[11px] leading-[1.35] text-ink-soft">
      {{ role }}
    </div>
    <div
      class="t-meta mt-3xs text-[9.5px] font-[650] leading-[1.35] text-indigo"
    >
      {{ meta }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { displayKind } from "#shared/engine/nodes";

import type { HoverUi } from "~/composables/useExplorer";

import { useExplorer } from "~/composables/useExplorer";

const props = defineProps<{ hover: HoverUi; }>();

const explorer = useExplorer();
const OFFSET = 16;
const CLAMP_RIGHT = 360;
const CLAMP_BOTTOM = 140;

const clampedX = computed(() =>
  Math.min(props.hover.x + OFFSET, window.innerWidth - CLAMP_RIGHT)
);
const clampedY = computed(() =>
  Math.min(props.hover.y + OFFSET, window.innerHeight - CLAMP_BOTTOM)
);

const otherName = (id: string): string =>
  explorer.engineState.value?.nodesById.get(id)?.name ?? id;

const name = computed(() => {
  const { node, edge } = props.hover;
  if (node) return node.name;
  if (edge) return `${otherName(edge.from)} → ${otherName(edge.to)}`;
  return "";
});

const kind = computed(() => {
  const { node, edge } = props.hover;
  if (node) return [displayKind(node), node.domain].filter(Boolean).join(" · ");
  if (edge) return [edge.kind, edge.mode].filter(Boolean).join(" · ");
  return "";
});

const role = computed(() => {
  const { node, edge } = props.hover;
  if (node) return node.hover.summary || node.responsibility || "";
  if (edge) return edge.purpose || "";
  return "";
});

const MAX_BADGES = 3;
const MAX_EDGE_META = 2;

const meta = computed(() => {
  const { node, edge } = props.hover;
  if (node) {
    const badges = (node.hover.badges.length > 0
      ? node.hover.badges
      : node.capabilities).slice(0, MAX_BADGES);
    if (badges.length > 0) return badges.join(" · ");
    const authority = node.authority || "unassigned authority";
    const data = node.dataClassifications.join(", ") || "no classified data";
    return `${authority} · ${data}`;
  }
  if (edge) {
    return [edge.protocol, edge.consistency, edge.failureHandling]
      .filter(Boolean)
      .slice(0, MAX_EDGE_META)
      .join(" · ");
  }
  return "";
});
</script>

<style scoped>
#tooltip.show {
  opacity: 1;
}
</style>
