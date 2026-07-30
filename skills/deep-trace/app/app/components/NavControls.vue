<template>
  <div
    id="nav"
    class="fixed bottom-[18px] right-[18px] z-10 flex flex-col items-end gap-2xs"
  >
    <div class="flex gap-2xs">
      <button
        id="rotL"
        aria-label="Rotate left"
        title="Rotate left"
        type="button"
        @click="emit('rotate', -1)"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 640 640"><path d="M112 64L112 166.1L139.1 139C239.1 39 401.2 39 501.1 139C551.1 189 576.1 254.5 576.1 320C576.1 461.4 461.5 576 320.1 576C217.7 576 129.4 515.9 88.5 429.2L131.9 408.7C165.2 479.3 237 528 320.1 528C435 528 528.1 434.9 528.1 320C528.1 266.7 507.8 213.5 467.2 172.9C386 91.7 254.3 91.7 173 172.9L145.9 200L248.1 200L248.1 248L64 248L64 64L112 64z" /></svg>
      </button>
      <button
        id="rotR"
        aria-label="Rotate right"
        title="Rotate right"
        type="button"
        @click="emit('rotate', 1)"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 640 640"><path d="M528.2 64L528.2 166.1L501.1 139C401.1 39 239 39 139.1 139C89.1 189 64.1 254.5 64.1 320C64.1 461.4 178.7 576 320.1 576C422.5 576 510.8 515.9 551.7 429.2L508.3 408.7C475 479.3 403.2 528 320.1 528C205.2 528 112.1 434.9 112.1 320C112.1 266.7 132.4 213.5 173 172.9C254.2 91.7 385.9 91.7 467.2 172.9L494.3 200L392.1 200L392.1 248L576.2 248L576.2 64L528.2 64z" /></svg>
      </button>
    </div>
    <div class="flex gap-2xs">
      <button
        id="zin"
        aria-label="Zoom in"
        title="Zoom in"
        type="button"
        @click="emit('zoom', 1.35)"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 640 640"><path d="M344 120C344 106.7 333.3 96 320 96C306.7 96 296 106.7 296 120L296 296L120 296C106.7 296 96 306.7 96 320C96 333.3 106.7 344 120 344L296 344L296 520C296 533.3 306.7 544 320 544C333.3 544 344 533.3 344 520L344 344L520 344C533.3 344 544 333.3 544 320C544 306.7 533.3 296 520 296L344 296L344 120z" /></svg>
      </button>
      <button
        id="zout"
        aria-label="Zoom out"
        title="Zoom out"
        type="button"
        @click="emit('zoom', 1 / 1.35)"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 640 640"><path d="M96 320C96 302.3 110.3 288 128 288L512 288C529.7 288 544 302.3 544 320C544 337.7 529.7 352 512 352L128 352C110.3 352 96 337.7 96 320z" /></svg>
      </button>
      <button
        id="zfit"
        aria-label="Reset view"
        title="Reset view"
        type="button"
        @click="emit('reset')"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 640 640"><path d="M336.4 70.1L320.4 55.7L304.4 70.1L72.4 278.1L54.5 294.1L86.5 329.8C100.1 317.6 108.7 309.9 112.3 306.6L112.3 575.9L528.3 575.9L528.3 306.6C532 309.9 540.6 317.6 554.1 329.8L586.1 294.1L568.2 278.1L336.2 70.1zM480.4 263.7L480.4 528L160.4 528L160.4 263.7L320.4 120.2L480.4 263.6z" /></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  zoom: [factor: number];
  rotate: [direction: number];
  reset: [];
}>();
</script>

<style scoped>
#nav button {
  min-width: 34px;
  height: 34px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-panel);
  color: var(--color-ink);
  line-height: 1;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 oklch(96% 0.01 225 / 0.07),
    0 12px 28px oklch(3% 0.006 245 / 0.48);
  padding: 0;
  display: grid;
  place-items: center;
}
#nav button:hover {
  background: var(--color-paper-bright);
}
#nav button svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
  pointer-events: none;
}
@media (max-width: 900px), (pointer: coarse) {
  #nav button {
    min-width: 44px;
    height: 44px;
  }
  #nav button svg {
    width: 18px;
    height: 18px;
  }
}
</style>
