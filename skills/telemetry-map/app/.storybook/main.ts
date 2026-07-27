import type { StorybookConfig } from "@storybook/vue3-vite";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";

// Storybook runs the components under plain vue3-vite, so the two Nuxt
// conveniences the SFCs rely on — Vue API auto-imports and component
// auto-registration — are recreated with the unplugin equivalents.
const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.ts"],
  framework: { name: "@storybook/vue3-vite", options: {} },
  viteFinal: (viteConfig) => {
    viteConfig.plugins = [
      ...(viteConfig.plugins ?? []),
      vue(),
      tailwindcss(),
      AutoImport({ imports: ["vue"], dts: false }),
      Components({
        dirs: [fileURLToPath(new URL("../app/components", import.meta.url))],
        dts: false,
      }),
    ];
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: {
        ...viteConfig.resolve?.alias,
        "#shared": fileURLToPath(new URL("../shared", import.meta.url)),
        "~": fileURLToPath(new URL("../app", import.meta.url)),
      },
    };
    return viteConfig;
  },
};

export default config;
