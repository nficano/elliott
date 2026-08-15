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

// A boot that fails on configuration is the FIRST thing a new operator sees, and
// an uncaught throw here prints a Bun stack dump with source excerpts around the
// throwing line. `elliott doctor` renders the identical fault as one line naming
// the field; the boot path had no reason to be worse. Same renderer, same secret
// set, so a credential interpolated into a message cannot ride out either.
//
// The doctor module is imported dynamically, on the failure path only: importing
// it at module scope would evaluate its config-reading dependencies before this
// try/catch is in place, which is the very thing that produced an unsanitized
// trace before.
try {
  await runtime.start();
} catch (error) {
  const { configErrorLine } = await import("./doctor/cli");
  process.stderr.write(
    `elliott: ${configErrorLine(error, runtime.resolvedSecrets)}\n`,
  );
  process.exit(1);
}
