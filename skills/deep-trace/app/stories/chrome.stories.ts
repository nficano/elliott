import type { Meta, StoryObj } from "@storybook/vue3-vite";

import DrawerSection from "~/components/DrawerSection.vue";
import EdgeItemButton from "~/components/EdgeItemButton.vue";
import HintBar from "~/components/HintBar.vue";
import HudCard from "~/components/HudCard.vue";
import KvList from "~/components/KvList.vue";
import NavControls from "~/components/NavControls.vue";
import TagRow from "~/components/TagRow.vue";
import TitleHud from "~/components/TitleHud.vue";

const meta: Meta = { title: "HUD/Chrome" };

export default meta;

export const Title: StoryObj = {
  render: () => ({
    components: { TitleHud },
    template:
      "<TitleHud subtitle=\"Elliott Runtime — Verified Connection Graph · " +
      "rev 2.0.0 · verified runtime + bundled skills\" />",
  }),
};

export const Card: StoryObj = {
  render: () => ({
    components: { HudCard },
    template:
      "<div style=\"width:252px\"><HudCard><template #title>Example" +
      "</template><p class=\"text-[12px]\">Card body content.</p>" +
      "</HudCard></div>",
  }),
};

export const Navigation: StoryObj = {
  render: () => ({
    components: { NavControls },
    template:
      "<div style=\"position:relative;min-height:160px\">" +
      "<NavControls /></div>",
  }),
};

export const Hint: StoryObj = {
  render: () => ({
    components: { HintBar },
    template:
      "<div style=\"position:relative;min-height:80px\"><HintBar /></div>",
  }),
};

export const Tags: StoryObj = {
  render: () => ({
    components: { TagRow },
    setup: () => ({
      tags: [
        { text: "runtime" },
        { text: "live", tone: "ok" },
        { text: "financial", tone: "warn" },
        { text: "pii", tone: "danger" },
      ],
    }),
    template: "<TagRow :tags=\"tags\" />",
  }),
};

export const KeyValues: StoryObj = {
  render: () => ({
    components: { KvList },
    setup: () => ({
      rows: [
        { label: "Protocol", value: "in-process" },
        { label: "Evidence", value: "verified" },
        { label: "Activation", value: "every turn" },
      ],
    }),
    template: "<KvList :rows=\"rows\" />",
  }),
};

export const Section: StoryObj = {
  render: () => ({
    components: { DrawerSection },
    setup: () => ({
      value: [
        "Runs the bounded round loop for each turn.",
        "Emits telemetry for observability.",
      ],
    }),
    template: "<DrawerSection title=\"Characteristics\" :value=\"value\" />",
  }),
};

export const ConnectionRow: StoryObj = {
  render: () => ({
    components: { EdgeItemButton },
    template:
      "<div style=\"width:320px\"><EdgeItemButton direction=\"OUT\" " +
      "dot-color=\"#39ff88\" kind=\"control\" kind-color=\"#39ff88\" " +
      "subtitle=\"Request model completion\" title=\"Model client\" />" +
      "</div>",
  }),
};
