import { createAgentKitFromSpecs } from "agent-kit/spec";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AgentKernel } from "../kernel";
import {
  envBackedSecretResolver,
  runtimeEnvironment,
  runtimeName,
} from "./config";

const resolveRuntimePath = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

const kernel = new AgentKernel({ posture: "standard" });
await kernel.start();

const runtimeDirectory = resolveRuntimePath("../../.elliott-runtime");
const runtimeSpecs = resolveRuntimePath("../../.elliott-runtime/agents");
await mkdir(runtimeSpecs, { recursive: true });
await copyFile(
  resolveRuntimePath("../../agents/elliott.yaml"),
  `${runtimeSpecs}/elliott.yaml`,
);

const kit = await createAgentKitFromSpecs({
  configDir: resolveRuntimePath("../../config"),
  specsDir: runtimeSpecs,
  assetsDir: resolveRuntimePath("../.."),
  env: runtimeName,
  appName: "elliott",
  resolver: envBackedSecretResolver,
  lockfilePath: `${runtimeDirectory}/agent-kit.lock`,
});

try {
  await kit.start();
  console.info(
    JSON.stringify({
      event: "elliott.runtime.started",
      environment: runtimeName,
      release: runtimeEnvironment["ELLIOTT_RELEASE"] ?? "dev",
    }),
  );
} catch (error) {
  await kernel.stop();
  throw error;
}
