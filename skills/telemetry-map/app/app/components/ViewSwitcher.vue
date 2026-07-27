<template>
  <HudCard>
    <template #title>
      View
    </template>
    <div id="viewSeg" class="seg">
      <button
        v-for="view in VIEWS"
        :key="view.mode"
        :aria-pressed="modelValue === view.mode"
        :class="{ on: modelValue === view.mode }"
        :data-view="view.mode"
        type="button"
        @click="emit('update:modelValue', view.mode)"
      >
        {{ view.label }}
      </button>
    </div>
  </HudCard>
</template>

<script setup lang="ts">
import type { ViewMode } from "#shared/types/explorer";

defineProps<{ modelValue: ViewMode; }>();

const emit = defineEmits<{ "update:modelValue": [mode: ViewMode]; }>();

const VIEWS: { mode: ViewMode; label: string; }[] = [
  { mode: "domains", label: "Domains" },
  { mode: "deploy", label: "Deploy" },
  { mode: "layers", label: "Stack" },
];
</script>

<style scoped>
.seg {
  display: flex;
  background: var(--color-surface-quiet);
  border-radius: 9px;
  padding: var(--spacing-3xs);
  gap: var(--spacing-3xs);
}
.seg button {
  flex: 1;
  border: 0;
  background: transparent;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 650;
  color: var(--color-ink-soft);
  padding: var(--spacing-2xs) var(--spacing-3xs);
  cursor: pointer;
  transition:
    background-color 0.15s var(--ease-out-map),
    color 0.15s var(--ease-out-map),
    transform 0.1s var(--ease-out-map);
}
.seg button.on {
  background: var(--color-paper-bright);
  color: var(--color-ink);
  box-shadow:
    inset 0 1px 0 oklch(96% 0.01 225 / 0.1),
    0 0 0 1px oklch(83% 0.16 220 / 0.24);
}
.seg button:active {
  transform: translateY(1px);
}
</style>
