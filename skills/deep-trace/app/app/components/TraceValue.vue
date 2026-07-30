<template>
  <div class="mb-2xs">
    <div
      class="mb-3xs font-code text-[9.5px] uppercase tracking-[0.06em] text-indigo"
    >
      {{ label }}
    </div>
    <p v-if="isShortText" class="text-[11.5px] leading-[1.45] [overflow-wrap:anywhere]">
      {{ text }}
    </p>
    <pre
      v-else
      class="max-h-[180px] overflow-auto whitespace-pre-wrap rounded-[8px] bg-code-bg p-2xs font-code text-[10px] leading-[1.5] [overflow-wrap:anywhere]"
    >{{ text }}</pre>
  </div>
</template>

<script setup lang="ts">
// One received/returned parameter in the trace inspector: short scalars
// render inline, long strings and structures in a scrollable code block.
const props = defineProps<{ label: string; value: unknown; }>();

const SHORT_TEXT_LIMIT = 160;

const text = computed(() => {
  const { value } = props;
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? String(value);
});

const isShortText = computed(() =>
  typeof props.value !== "object"
  && text.value.length <= SHORT_TEXT_LIMIT
  && !text.value.includes("\n")
);
</script>
