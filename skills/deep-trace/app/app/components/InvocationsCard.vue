<template>
  <HudCard id="invocationsCard">
    <template #title>
      <span>Invocations</span>
      <span class="font-code normal-case tracking-normal">{{
        invocations.length
      }}</span>
    </template>
    <div
      v-if="invocations.length > 0"
      id="invocationList"
      class="max-h-[180px] overflow-y-auto [scrollbar-width:thin]"
    >
      <button
        v-for="item in invocations"
        :key="item.runId"
        class="invocation block w-full cursor-pointer rounded-[7px] border-0 bg-transparent px-2xs py-3xs text-left font-[inherit]"
        :title="item.text || item.runId"
        type="button"
        @click="emit('replay', item.runId)"
      >
        <span
          class="line-clamp-2 text-[11px] leading-[1.35] text-ink [overflow-wrap:anywhere]"
        >
          <i
            aria-hidden="true"
            class="mr-1 inline-block h-[6px] w-[6px] rounded-full not-italic align-middle"
            :class="dotClass(item)"
          />{{ item.text || fallbackLabel(item) }}
        </span>
      </button>
    </div>
    <p v-else class="text-[10px] leading-[1.35] text-ink-soft">
      No invocations yet. Ask Elliott something above.
    </p>
  </HudCard>
</template>

<script setup lang="ts">
import type { InvocationItem } from "#shared/types/trace";

defineProps<{ invocations: readonly InvocationItem[]; }>();

const emit = defineEmits<{ replay: [runId: string]; }>();

const fallbackLabel = (item: InvocationItem): string =>
  [item.sender, item.gateway].filter(Boolean).join(" · ")
    || item.runId;

const dotClass = (item: InvocationItem): string => {
  if (item.disposition === "success") return "bg-success-ink";
  if (item.disposition === "failure") return "bg-danger-ink";
  return "bg-ink-soft";
};
</script>

<style scoped>
.invocation:hover {
  background: var(--color-surface-hover);
}
.invocation + .invocation {
  margin-top: 2px;
}
</style>
