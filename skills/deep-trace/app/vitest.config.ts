import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests cover the Vue-free shared/ modules and composable logic.
// The *.vitest.ts suffix keeps the repo-root `bun test` sweep from
// collecting these files (they require the vitest runtime).
export default defineConfig({
  resolve: {
    alias: {
      "#shared": fileURLToPath(new URL("shared", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.vitest.ts"],
    environment: "happy-dom",
  },
});
