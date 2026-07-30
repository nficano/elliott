<template>
  <button
    class="edgeitem flex w-full cursor-pointer items-start gap-2xs rounded-[8px] border-0 bg-transparent p-2xs text-left font-[inherit] text-[11px] leading-[1.3] text-ink"
    type="button"
    @click="emit('activate')"
  >
    <span
      class="w-6 flex-none text-[9px] font-extrabold text-ink-soft"
    >{{ direction }}</span>
    <i
      class="mt-3xs h-2 w-2 flex-none rounded-full border border-ink-soft not-italic"
      :style="{ background: dotColor }"
    />
    <span class="min-w-0">
      <b class="font-bold">{{ title }}</b>
      <span
        v-if="kind"
        class="ml-1 font-bold"
        :style="{ color: kindColor }"
      >{{ kind }}</span>
      <small v-if="subtitle" class="block text-[10px] text-ink-soft">
        {{ subtitle }}
      </small>
    </span>
  </button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    direction: string;
    title: string;
    dotColor: string;
    kind?: string;
    kindColor?: string;
    subtitle?: string;
  }>(),
  { kind: "", kindColor: "", subtitle: "" },
);

const emit = defineEmits<{ activate: []; }>();
</script>

<style scoped>
.edgeitem:hover {
  background: var(--color-surface-edge-hover);
}
</style>
