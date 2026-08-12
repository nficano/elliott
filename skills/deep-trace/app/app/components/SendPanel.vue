<template>
  <HudCard id="sendCard" :data-state="panel.state.value">
    <template #title>
      <span id="sendTitle">Ask Elliott</span>
    </template>
    <form id="sendForm" class="grid gap-3xs" @submit.prevent="submit">
      <textarea
        id="sendInput"
        v-model="text"
        aria-describedby="sendHint"
        :aria-invalid="panel.invalid.value"
        aria-labelledby="sendTitle"
        placeholder="What should Elliott do?"
        rows="2"
        @input="clearSendValidation"
        @keydown="onKeydown"
      />
      <button
        id="sendBtn"
        :aria-busy="panel.busy.value ? 'true' : undefined"
        :disabled="panel.busy.value"
        type="submit"
      >
        {{ panel.busy.value ? "Sending…" : "Send + trace" }}
      </button>
      <div id="sendHint" class="min-h-[1lh] text-[10px] leading-[1.35] text-ink-soft">
        {{ panel.hint.value }}
      </div>
    </form>
    <div
      id="sendResponse"
      aria-live="polite"
      :class="{ show: panel.responseShown.value }"
      role="status"
    >
      {{ panel.response.value }}
    </div>
  </HudCard>
</template>

<script setup lang="ts">
import {
  clearSendValidation,
  sendMessage,
  useSendPanel,
} from "~/composables/useSendMessage";

const panel = useSendPanel();
const text = ref("");

const submit = async (): Promise<void> => {
  const cleared = await sendMessage(text.value);
  if (cleared) text.value = "";
};

const onKeydown = (e: KeyboardEvent): void => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    void submit();
  }
};
</script>

<style scoped>
#sendInput {
  width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  min-height: 64px;
  padding: var(--spacing-2xs) var(--spacing-xs);
  font-size: 12px;
  background: var(--color-paper-bright);
  color: var(--color-ink);
  outline: 2px solid transparent;
  outline-offset: 1px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.4;
  transition:
    background-color 0.15s var(--ease-out-map),
    border-color 0.15s var(--ease-out-map);
}
#sendInput::placeholder {
  color: var(--color-ink-soft);
}
@media (hover: hover) and (pointer: fine) {
  #sendInput:hover {
    background: var(--color-panel-solid);
  }
  #sendBtn:not(:disabled):hover {
    background: var(--color-accent-line);
  }
}
#sendInput:focus-visible {
  border-color: var(--color-indigo);
}
#sendInput[aria-invalid="true"] {
  border-color: var(--color-danger-ink);
}
#sendBtn {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--color-indigo);
  border-radius: 7px;
  background: var(--color-accent-wash);
  color: var(--color-indigo);
  font-size: 11px;
  font-weight: 700;
  padding: var(--spacing-2xs) var(--spacing-xs);
  cursor: pointer;
  transition:
    background-color 0.15s var(--ease-out-map),
    transform 0.1s var(--ease-out-map);
}
#sendBtn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
[data-state="error"] #sendHint {
  color: var(--color-danger-ink);
}
[data-state="success"] #sendHint {
  color: var(--color-success-ink);
}
#sendResponse {
  margin-top: var(--spacing-2xs);
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-ink-soft);
  display: none;
  border-top: 1px solid var(--color-line-soft);
  padding-top: var(--spacing-2xs);
  max-height: 140px;
  overflow: auto;
  scrollbar-width: thin;
}
#sendResponse.show {
  display: block;
}
</style>
