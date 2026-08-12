<template>
  <div class="flex flex-wrap gap-3xs">
    <span
      v-for="tag in tags"
      :key="tag.text"
      class="tag rounded-[6px] px-2xs py-3xs text-[9.5px] font-bold"
      :class="toneClass(tag.tone)"
    >
      {{ tag.text }}
    </span>
  </div>
</template>

<script setup lang="ts">
import type { TagTone } from "#shared/utils/detail";

export interface TagItem {
  text: string;
  tone?: TagTone;
}

defineProps<{ tags: TagItem[]; }>();

const TONE_CLASSES: Record<string, string> = {
  danger: "bg-danger-wash text-danger-ink",
  warn: "bg-warning-wash text-warning-ink",
  ok: "bg-success-wash text-success-ink",
};

const toneClass = (tone: TagTone | undefined): string =>
  TONE_CLASSES[tone ?? ""] ?? "bg-surface-quiet text-ink";
</script>
