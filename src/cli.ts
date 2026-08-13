#!/usr/bin/env bun

import { fileURLToPath, pathToFileURL } from "node:url";
import { scaffoldConsumerAgent } from "./agent/index";
import { runSkillsCli } from "./install/cli";
import {
  executeEvolutionCli,
  makeHttpEvolutionCliBackend,
} from "./learning/evolution/cli/index";
import { scaffoldComponent } from "./manifest/scaffold";
import { runDoctorCli } from "./runtime/doctor/index";

const scaffold = async (arguments_: readonly string[]): Promise<boolean> => {
  const [command, kind, name, parentDirectory = "."] = arguments_;
  if (
    command !== "new"
    || (kind !== "skill" && kind !== "tool" && kind !== "agent")
    || name === undefined
  ) return false;
  if (kind === "agent") {
    const result = await scaffoldConsumerAgent({ name, parentDirectory });
    console.log(result.directory);
    return true;
  }
  const result = await scaffoldComponent({ kind, name, parentDirectory });
  console.log(result.directory);
  return true;
};

// The framework checkout root: cli.ts lives at <root>/src/cli.ts, so one level
// up from src/ is the root that holds config/, skills/, and agents/.
const frameworkRoot = fileURLToPath(new URL("..", import.meta.url));

const main = async (arguments_: readonly string[]): Promise<void> => {
  if (await scaffold(arguments_)) return;
  if (await runDoctorCli(arguments_, frameworkRoot)) return;
  if (await runSkillsCli(arguments_, process.cwd())) return;
  const endpoint = Bun.env["ELLIOTT_CONTROL_PLANE_URL"];
  if (endpoint === undefined) {
    throw new Error(
      "Evolution commands require ELLIOTT_CONTROL_PLANE_URL; "
        + "usage: elliott doctor | new skill|tool|agent <name> [directory]",
    );
  }
  const token = Bun.env["ELLIOTT_CONTROL_PLANE_TOKEN"];
  console.log(
    await executeEvolutionCli(
      arguments_,
      makeHttpEvolutionCliBackend(
        endpoint,
        globalThis.fetch,
        token === undefined ? undefined : `Bearer ${token}`,
      ),
    ),
  );
};

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Elliott command failed",
    );
    process.exitCode = 1;
  }
}
