<template>
  <div v-if="hasContent" class="sec mb-sm">
    <h4
      class="mb-2xs text-[9.5px] font-extrabold uppercase tracking-[0.09em] text-ink-soft"
    >
      {{ title }}
    </h4>
    <div v-if="lines.length > 0" class="grid gap-3xs">
      <p
        v-for="(line, index) in lines"
        :key="index"
        class="bullet relative pl-xs text-[12px] leading-[1.5]"
      >
        {{ line }}
      </p>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { detailLines } from "#shared/utils/detail";

const props = defineProps<{ title: string; value?: unknown; }>();

const slots = useSlots();
const lines = computed(() =>
  props.value === undefined ? [] : detailLines(props.value).filter(Boolean)
);
const hasContent = computed(() =>
  lines.value.length > 0 || slots["default"] !== undefined
);
</script>

<style scoped>
.bullet::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-indigo);
}
</style>
