import type { Ref } from "vue";

import { MAP_BASE } from "#shared/utils/base";

export type SendState = "" | "loading" | "error" | "success";

export interface SendPanelStore {
  state: Ref<SendState>;
  hint: Ref<string>;
  response: Ref<string>;
  responseShown: Ref<boolean>;
  busy: Ref<boolean>;
  invalid: Ref<boolean>;
}

export const DEFAULT_SEND_HINT =
  "⌘ Enter also sends. The runtime path appears below.";

const panel: SendPanelStore = {
  state: ref<SendState>(""),
  hint: ref(DEFAULT_SEND_HINT),
  response: ref(""),
  responseShown: ref(false),
  busy: ref(false),
  invalid: ref(false),
};

export const useSendPanel = (): SendPanelStore => panel;

export const clearSendValidation = (): void => {
  if (panel.invalid.value) {
    panel.invalid.value = false;
    panel.state.value = "";
    panel.hint.value = DEFAULT_SEND_HINT;
  }
};

const setSendState = (state: SendState, message?: string): void => {
  panel.state.value = state;
  panel.hint.value = message ?? DEFAULT_SEND_HINT;
};

interface SendResponseBody {
  text?: string;
  response?: string;
  answer?: string;
}

const postMessage = async (text: string): Promise<string> => {
  const response = await fetch(`${MAP_BASE}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`the server returned HTTP ${response.status}`);
  }
  const json = await response.json().catch(() => null) as
    | SendResponseBody
    | null;
  return json?.text ?? json?.response ?? json?.answer
    ?? "Elliott returned no response text.";
};

// The map lights up in real time from the live telemetry stream; there is
// no scripted explainer anymore.
const beginTrace = (): void => {
  panel.busy.value = true;
  setSendState("loading", "Sending — watch the map light up in real time…");
  panel.responseShown.value = true;
  panel.response.value = "Waiting for Elliott’s response…";
};

const deliver = async (message: string): Promise<boolean> => {
  try {
    panel.response.value = await postMessage(message);
    setSendState(
      "success",
      "Answered. Replay it from the invocations list below.",
    );
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    panel.response.value =
      `The message was not delivered because ${reason}. Try again.`;
    setSendState("error", "Message delivery failed. Try again.");
    return false;
  }
};

// Send a message to the agent while animating the map-message trace; the
// returned boolean reports whether the input should be cleared.
export const sendMessage = async (text: string): Promise<boolean> => {
  const message = text.trim();
  if (!message) {
    panel.invalid.value = true;
    setSendState("error", "Write a message before sending.");
    return false;
  }
  panel.invalid.value = false;
  beginTrace();
  const cleared = await deliver(message);
  panel.busy.value = false;
  return cleared;
};
