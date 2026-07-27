<template>
  <dl class="grid grid-cols-[88px_1fr] gap-x-xs gap-y-3xs text-[11.5px]">
    <template v-for="row in rows" :key="row.label">
      <dt class="font-semibold text-ink-soft">
        {{ row.label }}
      </dt>
      <dd class="font-semibold">
        <slot :name="row.slot" :row="row">
          {{ row.value }}
        </slot>
      </dd>
    </template>
  </dl>
</template>

<script setup lang="ts">
export interface KvRow {
  label: string;
  value?: string;
  slot?: string;
}

defineProps<{ rows: KvRow[]; }>();
</script>
