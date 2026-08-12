import type { EdgeBrightness } from "#shared/types/explorer";
import type { Meta, StoryObj } from "@storybook/vue3-vite";

import { ref } from "vue";

import EdgeBrightnessControl from "~/components/EdgeBrightnessControl.vue";

const meta: Meta<typeof EdgeBrightnessControl> = {
  title: "HUD/EdgeBrightnessControl",
  component: EdgeBrightnessControl,
};

export default meta;
type Story = StoryObj<typeof EdgeBrightnessControl>;

const at = (initial: EdgeBrightness, flowActive = false): Story => ({
  render: () => ({
    components: { EdgeBrightnessControl },
    setup: () => ({ value: ref<EdgeBrightness>(initial), flowActive }),
    template:
      "<div style=\"width:252px\"><EdgeBrightnessControl v-model=\"value\" " +
      ":flow-active=\"flowActive\" /></div>",
  }),
});

export const Off = at("off");
export const Dim = at("dim");
export const Bright = at("bright");
export const LockedDuringTrace = at("dim", true);
