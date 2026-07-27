import type { Meta, StoryObj } from "@storybook/vue3-vite";

import FlowPlayer from "~/components/FlowPlayer.vue";

import { withFixtureStore } from "./fixtures";

const meta: Meta<typeof FlowPlayer> = {
  title: "HUD/FlowPlayer",
  component: FlowPlayer,
};

export default meta;
type Story = StoryObj<typeof FlowPlayer>;

const atStep = (stepIndex: number, playing: boolean): Story => ({
  render: () => ({
    components: { FlowPlayer },
    setup: () => {
      const { pack } = withFixtureStore();
      const flow = pack.flows[0];
      if (!flow) throw new Error("fixture flow missing");
      return {
        flow,
        flowUi: {
          active: true,
          name: flow.name,
          stepIndex,
          stepCount: flow.steps.length,
          playing,
          progress: (stepIndex + (playing ? 0.4 : 1)) / flow.steps.length,
        },
      };
    },
    template:
      "<div style=\"position:relative;min-height:240px\">" +
      "<FlowPlayer :flow=\"flow\" :flow-ui=\"flowUi\" /></div>",
  }),
});

export const Playing = atStep(0, true);
export const PausedMidFlow = atStep(4, false);
export const FinalStep = atStep(9, false);
