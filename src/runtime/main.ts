import { fileURLToPath } from "node:url";
import { ElliottRuntime } from "./app";

const root = fileURLToPath(new URL("../..", import.meta.url));
const runtime = new ElliottRuntime(root);

const shutdown = async (): Promise<void> => {
  await runtime.stop();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await runtime.start();
