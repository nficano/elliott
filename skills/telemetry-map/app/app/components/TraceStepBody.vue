<template>
  <div id="traceBody">
    <div class="mb-sm flex items-start justify-between gap-2xs">
      <p class="text-[12px] leading-[1.5]">
        {{ step.action }}
      </p>
      <button
        id="traceRawToggle"
        :aria-pressed="raw"
        class="flex-none cursor-pointer rounded-[7px] border border-line bg-surface-quiet px-2xs py-3xs text-[9.5px] font-bold uppercase tracking-[0.06em] text-ink-soft"
        :class="{ on: raw }"
        type="button"
        @click="raw = !raw"
      >
        Raw
      </button>
    </div>
    <template v-if="raw">
      <DrawerSection title="Raw event">
        <pre
          class="max-h-[380px] overflow-auto rounded-[10px] bg-code-bg p-xs font-code text-[10px] leading-[1.55]"
        ><span
          v-for="(segment, index) in rawSegments"
          :key="index"
          :class="toneClass(segment.tone)"
        >{{ segment.text }}</span></pre>
      </DrawerSection>
    </template>
    <template v-else>
      <DrawerSection v-if="receivedRows.length > 0" title="Received">
        <TraceValue
          v-for="row in receivedRows"
          :key="`in-${row.key}`"
          :label="row.key"
          :value="row.value"
        />
      </DrawerSection>
      <DrawerSection v-if="returnedRows.length > 0" title="Returned">
        <TraceValue
          v-for="row in returnedRows"
          :key="`out-${row.key}`"
          :label="row.key"
          :value="row.value"
        />
      </DrawerSection>
      <DrawerSection
        v-if="receivedRows.length === 0 && returnedRows.length === 0"
        title="Recorded data"
      >
        <p class="text-[11px] text-ink-soft">
          This event carried no additional payload.
        </p>
      </DrawerSection>
      <DrawerSection title="Event">
        <KvList
          :rows="[
            { label: 'Type', value: step.eventType },
            { label: 'At', value: step.at },
          ]"
        />
      </DrawerSection>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { TraceStep } from "#shared/types/trace";
import type { JsonSegment } from "#shared/utils/detail";

import { jsonSegments } from "#shared/utils/detail";

const props = defineProps<{ step: TraceStep; }>();

const raw = ref(false);

interface Row {
  key: string;
  value: unknown;
}

const rows = (record: Readonly<Record<string, unknown>>): Row[] =>
  Object.entries(record).map(([key, value]) => ({ key, value }));

const receivedRows = computed(() => rows(props.step.received));
const returnedRows = computed(() => rows(props.step.returned));
const rawSegments = computed(() => jsonSegments(props.step.raw));

const TONE_CLASSES: Record<string, string> = {
  key: "text-code-key",
  string: "text-code-string",
  number: "text-code-number",
  boolean: "text-code-boolean",
};

const toneClass = (tone: JsonSegment["tone"]): string =>
  TONE_CLASSES[tone] ?? "";
</script>

<style scoped>
#traceRawToggle.on {
  background: var(--color-accent-wash);
  border-color: var(--color-indigo);
  color: var(--color-indigo);
}
</style>
