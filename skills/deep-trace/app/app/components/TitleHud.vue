<template>
  <div
    id="title"
    class="pointer-events-none fixed left-[22px] top-[18px] z-10 max-w-[calc(100%-318px)] max-[900px]:max-w-[calc(100%-44px)]"
  >
    <h1
      class="font-display text-[21px] font-bold tracking-[-0.02em] [overflow-wrap:anywhere]"
    >
      Elliott <span class="text-indigo">Stack Explorer</span>
    </h1>
    <p id="subtitle" class="mt-3xs text-[11.5px] text-ink-soft">
      {{ subtitle }}
    </p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ subtitle: string; }>();
</script>
