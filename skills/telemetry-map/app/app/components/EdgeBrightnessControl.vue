<template>
  <HudCard id="presetCard">
    <template #title>
      Presets
    </template>
    <div
      id="edgeBrightnessControl"
      class="grid gap-3xs"
      :data-value="String(valueIndex)"
    >
      <div class="flex items-center justify-between gap-2xs text-[11px] font-[650] text-ink">
        <label for="edgeBrightness">Edge brightness</label>
        <output
          id="edgeBrightnessValue"
          class="text-[10px] font-[750] uppercase tracking-[0.06em] text-indigo"
          for="edgeBrightness"
        >
          {{ label }}
        </output>
      </div>
      <input
        id="edgeBrightness"
        aria-describedby="edgeBrightnessHint"
        :aria-valuetext="ariaValueText"
        :disabled="flowActive"
        max="2"
        min="0"
        step="1"
        type="range"
        :value="valueIndex"
        @input="onInput"
      />
      <div aria-hidden="true" class="flex justify-between text-[9.5px] font-[650] text-ink-soft">
        <span>Off</span><span>Dim</span><span>Bright</span>
      </div>
      <p id="edgeBrightnessHint" class="min-h-[1lh] text-[10px] leading-[1.35] text-ink-soft">
        {{ hint }}
      </p>
    </div>
  </HudCard>
</template>

<script setup lang="ts">
import type { EdgeBrightness } from "#shared/types/explorer";

const props = defineProps<{
  modelValue: EdgeBrightness;
  flowActive: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: EdgeBrightness]; }>();

const PRESETS: EdgeBrightness[] = ["off", "dim", "bright"];
const LABELS = ["Off", "Dim", "Bright"];
const HINTS = [
  "Edges stay hidden until a trace starts.",
  "Dim keeps the map quiet until a trace starts.",
  "Edges use full brightness outside traces.",
];

const valueIndex = computed(() =>
  Math.max(0, PRESETS.indexOf(props.modelValue))
);
const label = computed(() =>
  props.flowActive ? "Trace · Bright" : LABELS[valueIndex.value]
);
const ariaValueText = computed(() =>
  props.flowActive ? "Bright during trace" : LABELS[valueIndex.value]
);
const hint = computed(() =>
  props.flowActive
    ? "Trace mode temporarily uses Bright. Your preset resumes afterward."
    : HINTS[valueIndex.value]
);

const onInput = (event: Event): void => {
  const raw = Number((event.currentTarget as HTMLInputElement).value);
  emit("update:modelValue", PRESETS[raw] ?? "dim");
};
</script>

<style scoped>
#edgeBrightness {
  --edge-fill: 50%;
  appearance: none;
  width: 100%;
  height: 44px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  outline: 2px solid transparent;
  outline-offset: 1px;
}
#edgeBrightness::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 99px;
  background: linear-gradient(
    to right,
    var(--color-indigo) 0 var(--edge-fill),
    var(--color-surface-progress) var(--edge-fill) 100%
  );
}
#edgeBrightness::-moz-range-track {
  height: 6px;
  border-radius: 99px;
  background: var(--color-surface-progress);
}
#edgeBrightness::-moz-range-progress {
  height: 6px;
  border-radius: 99px;
  background: var(--color-indigo);
}
#edgeBrightness::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  margin-top: -6px;
  border-radius: 50%;
  border: 2px solid var(--color-indigo);
  background: var(--color-tile-raised);
}
#edgeBrightness::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--color-indigo);
  background: var(--color-tile-raised);
}
#edgeBrightness:focus-visible {
  outline: 2px solid var(--color-indigo);
  outline-offset: 2px;
  border-radius: 9px;
}
#edgeBrightness:disabled {
  cursor: not-allowed;
}
[data-value="0"] #edgeBrightness {
  --edge-fill: 0%;
}
[data-value="1"] #edgeBrightness {
  --edge-fill: 50%;
}
[data-value="2"] #edgeBrightness {
  --edge-fill: 100%;
}
</style>
