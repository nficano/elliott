import type { Meta, StoryObj } from "@storybook/vue3-vite";

import DetailDrawer from "~/components/DetailDrawer.vue";

import { fixtureEdge, fixtureNode, withFixtureStore } from "./fixtures";

const meta: Meta<typeof DetailDrawer> = {
  title: "HUD/DetailDrawer",
  component: DetailDrawer,
};

export default meta;
type Story = StoryObj<typeof DetailDrawer>;

export const ComponentDetail: Story = {
  render: () => ({
    components: { DetailDrawer },
    setup: () => {
      const { pack } = withFixtureStore();
      return { node: fixtureNode(pack) };
    },
    template:
      "<DetailDrawer :edge=\"null\" :node=\"node\" :open=\"true\" />",
  }),
};

export const ConnectionDetail: Story = {
  render: () => ({
    components: { DetailDrawer },
    setup: () => {
      const { pack } = withFixtureStore();
      return { edge: fixtureEdge(pack) };
    },
    template:
      "<DetailDrawer :edge=\"edge\" :node=\"null\" :open=\"true\" />",
  }),
};
