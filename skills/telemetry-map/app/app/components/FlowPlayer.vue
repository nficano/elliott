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
            <svg class="icon" viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">
              <path d="M167.5 303C158.1 312.4 158.1 327.6 167.5 336.9L367.5 536.9C376.9 546.3 392.1 546.3 401.4 536.9C410.7 527.5 410.8 512.3 401.4 503L218.4 320L401.4 137C410.8 127.6 410.8 112.4 401.4 103.1C392 93.8 376.8 93.7 367.5 103.1L167.5 303z" />
            </svg>
          </button>
          <button
            id="fpPlay"
            :aria-label="flowUi.playing ? 'Pause flow' : 'Play flow'"
            title="Play or pause"
            type="button"
            @click="emit('toggle-play')"
          >
            <svg v-if="flowUi.playing" class="icon" viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">
              <path d="M176 96C149.5 96 128 117.5 128 144L128 496C128 522.5 149.5 544 176 544L208 544C234.5 544 256 522.5 256 496L256 144C256 117.5 234.5 96 208 96L176 96zM432 96C405.5 96 384 117.5 384 144L384 496C384 522.5 405.5 544 432 544L464 544C490.5 544 512 522.5 512 496L512 144C512 117.5 490.5 96 464 96L432 96z" />
            </svg>
            <svg v-else class="icon" viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">
              <path d="M147.6 101.6C135.5 108.8 128 121.9 128 136L128 504C128 518.1 135.5 531.2 147.6 538.4C159.7 545.6 174.8 545.9 187.2 539.1L523.2 355.1C536 348.1 544 334.6 544 320C544 305.4 536 291.9 523.2 284.9L187.2 100.9C174.8 94.1 159.8 94.4 147.6 101.6zM176 490.5L176 149.5L487.3 320L176 490.5z" />
            </svg>
          </button>
          <button
            id="fpNext"
            aria-label="Next path step"
            title="Next step"
            type="button"
            @click="emit('advance', 1)"
          >
            <svg class="icon" viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">
              <path d="M473.5 303C482.9 312.4 482.9 327.6 473.5 336.9L273.5 536.9C264.1 546.3 248.9 546.3 239.6 536.9C230.3 527.5 230.2 512.3 239.6 503L422.6 320L239.6 137C230.2 127.6 230.2 112.4 239.6 103.1C249 93.8 264.2 93.7 273.5 103.1L473.5 303.1z" />
            </svg>
          </button>
          <button
            id="fpExit"
            aria-label="Close path"
            title="Close path"
            type="button"
            @click="emit('exit')"
          >
            <svg class="icon" viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">
              <path d="M135.5 169C126.1 159.6 126.1 144.4 135.5 135.1C144.9 125.8 160.1 125.7 169.4 135.1L320.4 286.1L471.4 135.1C480.8 125.7 496 125.7 505.3 135.1C514.6 144.5 514.7 159.7 505.3 169L354.3 320L505.3 471C514.7 480.4 514.7 495.6 505.3 504.9C495.9 514.2 480.7 514.3 471.4 504.9L320.4 353.9L169.4 504.9C160 514.3 144.8 514.3 135.5 504.9C126.2 495.5 126.1 480.3 135.5 471L286.5 320L135.5 169z" />
            </svg>
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
.ml-auto button .icon {
  width: 12px;
  height: 12px;
  display: block;
}
@media (pointer: coarse) {
  .ml-auto button {
    min-height: 44px;
  }
}
</style>
