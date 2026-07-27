import type { Preview } from "@storybook/vue3-vite";

import "../app/assets/css/main.css";

// The map is a dark, full-viewport HUD; give stories the same backdrop.
const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    layout: "fullscreen",
  },
  decorators: [
    (story) => ({
      components: { story },
      template:
        "<div style=\"min-height:100vh;padding:24px;background:" +
        "radial-gradient(circle at 48% 36%,oklch(17% 0.011 245) 0%," +
        "oklch(13.5% 0.009 245) 58%,oklch(10.5% 0.008 245) 100%)\">" +
        "<story /></div>",
    }),
  ],
};

export default preview;
