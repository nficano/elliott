<template>
  <div
    class="shadow-hud rounded-card border border-line bg-panel p-xs"
  >
    <h2
      class="mb-2xs flex items-center justify-between text-[10px] font-normal uppercase tracking-[0.09em] text-ink-soft"
    >
      <slot name="title" />
    </h2>
    <slot />
  </div>
</template>

<script setup lang="ts">
// Shared HUD card chrome: panel background, hairline border, soft shadow.
</script>
