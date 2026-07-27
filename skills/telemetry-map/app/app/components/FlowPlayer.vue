<template>
  <div
    id="flowPlayer"
    :aria-hidden="!flowUi.active"
    class="fixed bottom-16 left-1/2 z-[15] w-[min(560px,calc(100%-40px))] max-[900px]:bottom-[72px] max-[900px]:w-[calc(100%-32px)]"
    :class="{ show: flowUi.active }"
    :inert="!flowUi.active"
    @focusin="emit('pause')"
    @pointerenter="emit('pause')"
  >
    <div
      class="card shadow-hud pointer-events-auto rounded-card border border-line bg-panel px-sm py-xs"
    >
      <div class="mb-2xs flex items-center gap-xs">
        <div id="fpTitle" class="flex-1 text-[13px] font-extrabold tracking-[-0.01em]">
          {{ flowUi.name }}
        </div>
        <div id="fpStep" class="flex-none font-code text-[10px] font-extrabold text-indigo">
          STEP {{ flowUi.stepIndex + 1 }}/{{ flowUi.stepCount }}
        </div>
        <div class="ml-auto flex gap-3xs">
          <button
            id="fpPrev"
            aria-label="Previous path step"
            title="Previous step"
            type="button"
            @click="emit('advance', -1)"
          >
            ‹
          </button>
          <button
            id="fpPlay"
            :aria-label="flowUi.playing ? 'Pause flow' : 'Play flow'"
            title="Play or pause"
            type="button"
            @click="emit('toggle-play')"
          >
            {{ flowUi.playing ? "⏸" : "▶" }}
          </button>
          <button
            id="fpNext"
            aria-label="Next path step"
            title="Next step"
            type="button"
            @click="emit('advance', 1)"
          >
            ›
          </button>
          <button
            id="fpExit"
            aria-label="Close path"
            title="Close path"
            type="button"
            @click="emit('exit')"
          >
            ✕
          </button>
        </div>
      </div>
      <div id="fpAction" class="text-[12px] leading-[1.45]">
        <b>{{ fromName }}</b> → <b>{{ toName }}</b> — {{ step?.action }}
      </div>
      <div id="fpMeta" class="mt-2xs flex flex-wrap gap-3xs">
        <span
          v-for="tag in step?.data ?? []"
          :key="tag"
          class="rounded-[6px] bg-surface-quiet px-2xs py-3xs text-[9.5px] font-bold text-ink"
        >{{ tag }}</span>
        <span
          v-if="step?.transport"
          class="rounded-[6px] bg-success-wash px-2xs py-3xs text-[9.5px] font-bold text-success-ink"
        >{{ step.transport }}</span>
      </div>
      <div id="fpResult" class="mt-2xs text-[11px] leading-[1.4] text-ink-soft">
        {{ resultLine }}
      </div>
      <div
        id="fpBar"
        aria-hidden="true"
        class="mt-xs h-[3px] overflow-hidden rounded-full bg-surface-progress"
      >
        <i
          class="block h-full w-full origin-left rounded-full bg-indigo not-italic transition-transform duration-200 ease-linear"
          :style="{ transform: `scaleX(${flowUi.progress})` }"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Flow } from "#shared/types/explorer";

import type { FlowUi } from "~/composables/useExplorer";

import { useExplorer } from "~/composables/useExplorer";

const props = defineProps<{ flowUi: FlowUi; flow: Flow | null; }>();

const emit = defineEmits<{
  advance: [direction: number];
  "toggle-play": [];
  exit: [];
  pause: [];
}>();

const explorer = useExplorer();

const step = computed(() => props.flow?.steps[props.flowUi.stepIndex]);

const nodeName = (id: string | undefined): string => {
  if (id === undefined) return "";
  return explorer.engineState.value?.nodesById.get(id)?.name ?? id;
};

const fromName = computed(() => nodeName(step.value?.from));
const toName = computed(() => nodeName(step.value?.to));

const resultLine = computed(() => {
  const flow = props.flow;
  if (!flow) return "";
  const context: string[] = [];
  if (step.value?.result) context.push(step.value.result);
  if (props.flowUi.stepIndex === flow.steps.length - 1) {
    const note = flow.consistencyNotes[0];
    if (note !== undefined) context.push(`Consistency: ${note}`);
    const failure = flow.failurePoints[0];
    if (failure !== undefined) context.push(`Watch: ${failure}`);
  }
  return context.join(" · ");
});
</script>

<style scoped>
#flowPlayer {
  transform: translate(-50%, 20px);
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition:
    opacity 0.3s var(--ease-out-map),
    transform 0.3s var(--ease-out-map),
    visibility 0s linear 0.3s;
}
#flowPlayer.show {
  opacity: 1;
  transform: translate(-50%, 0);
  visibility: visible;
  transition-delay: 0s;
}
.ml-auto button {
  width: 26px;
  height: 26px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-paper-bright);
  cursor: pointer;
  font-size: 11px;
  color: var(--color-ink);
}
.ml-auto button:hover {
  border-color: var(--color-indigo);
}
@media (pointer: coarse) {
  .ml-auto button {
    min-height: 44px;
  }
}
</style>
