<template>
  <div>
    <div class="mb-sm">
      <p class="text-[12px] leading-[1.5]">
        {{ edge.purpose }}
      </p>
    </div>
    <DrawerSection title="Verified connection">
      <KvList
        :rows="[
          { label: 'Protocol', value: edge.protocol || '—' },
          { label: 'Evidence', value: edge.confidence || '—' },
          { label: 'Activation', value: edge.original.activation || '—' },
        ]"
      />
    </DrawerSection>
    <DrawerSection v-if="routes.length > 0" title="Routes / subjects">
      <div
        v-for="route in routes"
        :key="route"
        class="break-all py-3xs font-code text-[10px] text-ink-soft"
      >
        <b class="font-semibold text-ink">{{ route }}</b>
      </div>
    </DrawerSection>
    <DrawerSection v-if="edge.data.length > 0" title="Data on the wire">
      <TagRow :tags="edge.data.map((text) => ({ text }))" />
    </DrawerSection>
    <DrawerSection
      v-if="edge.dataClassifications.length > 0"
      title="Classification"
    >
      <TagRow
        :tags="edge.dataClassifications.map((text) => ({
          text,
          tone: classificationTone(text),
        }))"
      />
    </DrawerSection>
    <DrawerSection title="Consistency" :value="edge.consistency" />
    <DrawerSection title="Failure handling" :value="edge.failureHandling" />
    <DrawerSection title="Security" :value="edge.security" />
    <DrawerSection title="Endpoints">
      <EdgeItemButton
        direction="SRC"
        :dot-color="endpointColor(edge.from)"
        :title="endpointName(edge.from)"
        @activate="emit('select-node', edge.from)"
      />
      <EdgeItemButton
        direction="DST"
        :dot-color="endpointColor(edge.to)"
        :title="endpointName(edge.to)"
        @activate="emit('select-node', edge.to)"
      />
    </DrawerSection>
  </div>
</template>

<script setup lang="ts">
import type { ExplorerEdge } from "#shared/types/explorer";

import { classificationTone } from "#shared/utils/detail";
import { CANVAS_COLOR, domainColor } from "#shared/utils/palette";

import { useExplorer } from "~/composables/useExplorer";

const props = defineProps<{ edge: ExplorerEdge; }>();

const emit = defineEmits<{ "select-node": [nodeId: string]; }>();

const explorer = useExplorer();

const routes = computed(() =>
  props.edge.routeOrSubject ? [props.edge.routeOrSubject] : []
);

const endpointName = (id: string): string =>
  explorer.engineState.value?.nodesById.get(id)?.name ?? id;

const endpointColor = (id: string): string => {
  const node = explorer.engineState.value?.nodesById.get(id);
  return node ? domainColor(node) : CANVAS_COLOR.itemFallback;
};
</script>
