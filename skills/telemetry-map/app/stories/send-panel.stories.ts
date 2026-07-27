import type { Meta, StoryObj } from "@storybook/vue3-vite";

import SendPanel from "~/components/SendPanel.vue";
import {
  DEFAULT_SEND_HINT,
  useSendPanel,
} from "~/composables/useSendMessage";

const meta: Meta<typeof SendPanel> = {
  title: "HUD/SendPanel",
  component: SendPanel,
};

export default meta;
type Story = StoryObj<typeof SendPanel>;

const panelState = (
  state: "" | "loading" | "error" | "success",
  hint: string,
  response = "",
): Story => ({
  render: () => ({
    components: { SendPanel },
    setup: () => {
      const panel = useSendPanel();
      panel.state.value = state;
      panel.hint.value = hint;
      panel.response.value = response;
      panel.responseShown.value = response.length > 0;
      panel.busy.value = state === "loading";
      panel.invalid.value = state === "error" && response.length === 0;
      return {};
    },
    template: "<div style=\"width:252px\"><SendPanel /></div>",
  }),
});

export const Idle = panelState("", DEFAULT_SEND_HINT);
export const Validating = panelState(
  "error",
  "Write a message before sending.",
);
export const Tracing = panelState(
  "loading",
  "Tracing the request through Elliott…",
  "Waiting for Elliott’s response…",
);
export const Answered = panelState(
  "success",
  "Trace complete. The highlighted path stays available below.",
  "echo: what is the runtime topology?",
);
