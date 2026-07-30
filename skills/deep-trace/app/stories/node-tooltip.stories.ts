import type { Meta, StoryObj } from "@storybook/vue3-vite";

import NodeTooltip from "~/components/NodeTooltip.vue";

import { fixtureEdge, fixtureNode, withFixtureStore } from "./fixtures";

const meta: Meta<typeof NodeTooltip> = {
  title: "HUD/NodeTooltip",
  component: NodeTooltip,
};

export default meta;
type Story = StoryObj<typeof NodeTooltip>;

export const NodeHover: Story = {
  render: () => ({
    components: { NodeTooltip },
    setup: () => {
      const { pack } = withFixtureStore();
      return {
        hover: {
          node: fixtureNode(pack),
          edge: null,
          x: 40,
          y: 40,
          shown: true,
        },
      };
    },
    template: "<NodeTooltip :hover=\"hover\" />",
  }),
};

export const EdgeHover: Story = {
  render: () => ({
    components: { NodeTooltip },
    setup: () => {
      const { pack } = withFixtureStore();
      return {
        hover: {
          node: null,
          edge: fixtureEdge(pack),
          x: 40,
          y: 40,
          shown: true,
        },
      };
    },
    template: "<NodeTooltip :hover=\"hover\" />",
  }),
};
