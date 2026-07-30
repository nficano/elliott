<template>
  <div
    id="hint"
    class="shadow-hud fixed bottom-[18px] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-panel px-sm py-2xs text-[11px] text-ink-soft max-[900px]:hidden"
  >
    <b>Drag</b> pan · <b>Twist / ⇧ drag</b> rotate · <b>Scroll ⇅</b> tilt ·
    <b>Pinch / dblclick</b> zoom · <b>Click</b> a node or edge · <b>Esc</b>
    clear
  </div>
</template>

<script setup lang="ts">
// Static gesture vocabulary bar.
</script>

<style scoped>
b {
  color: var(--color-ink);
  font-weight: 650;
}
</style>
