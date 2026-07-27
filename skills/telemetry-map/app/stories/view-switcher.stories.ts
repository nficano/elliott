import type { ViewMode } from "#shared/types/explorer";
import type { Meta, StoryObj } from "@storybook/vue3-vite";

import { ref } from "vue";

import ViewSwitcher from "~/components/ViewSwitcher.vue";

const meta: Meta<typeof ViewSwitcher> = {
  title: "HUD/ViewSwitcher",
  component: ViewSwitcher,
};

export default meta;
type Story = StoryObj<typeof ViewSwitcher>;

const interactive = (initial: ViewMode): Story => ({
  render: () => ({
    components: { ViewSwitcher },
    setup: () => ({ mode: ref<ViewMode>(initial) }),
    template:
      "<div style=\"width:252px\"><ViewSwitcher v-model=\"mode\" /></div>",
  }),
});

export const Domains = interactive("domains");
export const Deploy = interactive("deploy");
export const Stack = interactive("layers");
