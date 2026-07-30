<template>
  <div>
    <div class="mb-sm">
      <p class="text-[12px] leading-[1.5]">
        {{ node.responsibility }}
      </p>
    </div>
    <DrawerSection v-if="node.capabilities.length > 0" title="Capabilities">
      <TagRow :tags="node.capabilities.map((text) => ({ text }))" />
    </DrawerSection>
    <DrawerSection v-if="node.designRationale" title="Why this boundary">
      <div
        class="rounded-[9px] border border-accent-line bg-accent-wash px-xs py-2xs text-[11px] leading-[1.45]"
      >
        {{ node.designRationale }}
      </div>
    </DrawerSection>
    <DrawerSection title="Interfaces" :value="node.detail.interfaces" />
    <DrawerSection title="Data ownership" :value="node.detail.dataOwnership" />
    <DrawerSection title="Runtime">
      <KvList :rows="runtimeRows">
        <template #runtime>
          <TagRow
            :tags="[{ text: node.runtime.state || '?', tone: runtimeTone }]"
          />
        </template>
      </KvList>
    </DrawerSection>
    <DrawerSection title="Authority details" :value="node.authorityDetail" />
    <DrawerSection
      v-if="node.dataClassifications.length > 0"
      title="Data handled"
    >
      <TagRow
        :tags="node.dataClassifications.map((text) => ({
          text,
          tone: classificationTone(text),
        }))"
      />
    </DrawerSection>
    <DrawerSection title="Scaling" :value="node.scaling" />
    <DrawerSection title="Security" :value="node.security" />
    <DrawerSection
      v-if="node.detail.observability.length === 0 && !node.detail.failureModes"
      title="Operability"
      :value="node.operability"
    />
    <DrawerSection title="Observability" :value="node.detail.observability" />
    <DrawerSection title="Failure modes" :value="node.detail.failureModes" />
    <DrawerSection
      v-if="connections.length > 0"
      :title="`Connections (${connections.length})`"
    >
      <EdgeItemButton
        v-for="item in connections"
        :key="`${item.direction}-${item.edge.id}`"
        :direction="item.direction"
        :dot-color="edgeColor(item.edge)"
        :kind="item.edge.kind"
        :kind-color="edgeColor(item.edge)"
        :subtitle="item.edge.purpose"
        :title="otherName(item)"
        @activate="emit('select-edge', item.edge)"
      />
    </DrawerSection>
    <DrawerSection v-if="node.sourceRefs.length > 0" title="Evidence in repo">
      <div
        v-for="refItem in node.sourceRefs"
        :key="refItem.path"
        class="break-all py-3xs font-code text-[10px] text-ink-soft"
      >
        <b class="font-semibold text-ink">{{ refItem.path }}</b>
        — {{ refItem.purpose }}
      </div>
    </DrawerSection>
  </div>
</template>

<script setup lang="ts">
import type { ExplorerEdge, ExplorerNode } from "#shared/types/explorer";

import { classificationTone } from "#shared/utils/detail";
import { CANVAS_COLOR } from "#shared/utils/palette";

import type { KvRow } from "~/components/KvList.vue";

import { useExplorer } from "~/composables/useExplorer";

const props = defineProps<{ node: ExplorerNode; }>();

const emit = defineEmits<{ "select-edge": [edge: ExplorerEdge]; }>();

const explorer = useExplorer();

interface Connection {
  direction: "OUT" | "IN";
  edge: ExplorerEdge;
}

const connections = computed<Connection[]>(() => {
  const state = explorer.engineState.value;
  const edges = state?.edgesByNode.get(props.node.id) ?? [];
  return [
    ...edges.filter((edge) => edge.from === props.node.id)
      .map((edge): Connection => ({ direction: "OUT", edge })),
    ...edges.filter((edge) => edge.to === props.node.id)
      .map((edge): Connection => ({ direction: "IN", edge })),
  ];
});

const otherName = (item: Connection): string => {
  const otherId = item.direction === "OUT" ? item.edge.to : item.edge.from;
  return explorer.engineState.value?.nodesById.get(otherId)?.name ?? "?";
};

const edgeColor = (edge: ExplorerEdge): string =>
  explorer.engineState.value?.edgeStyle.get(edge.kind)?.color
    ?? CANVAS_COLOR.itemFallback;

const dash = "—";
const runtimeRows = computed<KvRow[]>(() => [
  {
    label: "Models",
    value: props.node.runtime.models.join(", ") || dash,
  },
  {
    label: "Languages",
    value: props.node.runtime.languages.join(", ") || dash,
  },
  {
    label: "Regions",
    value: props.node.runtime.regions.map((r) => r.toUpperCase())
      .join(" · ") || dash,
  },
  { label: "Runtime", slot: "runtime" },
  { label: "Authority", value: props.node.authority || dash },
  { label: "Evidence", value: props.node.confidence || dash },
]);

const runtimeTone = computed(() => {
  if (props.node.runtime.lifecycle === "active") return "ok" as const;
  if (props.node.runtime.lifecycle === "migration") return "warn" as const;
  return "danger" as const;
});
</script>
