#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { scaffoldConsumerAgent } from "./agent/index";
import { scaffoldComponent } from "./manifest/scaffold";

const main = async (arguments_: readonly string[]): Promise<void> => {
  const [command, kind, name, parentDirectory = "."] = arguments_;
  if (
    command !== "new"
    || (kind !== "skill" && kind !== "tool" && kind !== "agent")
    || name === undefined
  ) {
    throw new Error("Usage: elliott new skill|tool|agent <name> [directory]");
  }
  if (kind === "agent") {
    const result = await scaffoldConsumerAgent({ name, parentDirectory });
    console.log(result.directory);
    return;
  }
  const result = await scaffoldComponent({ kind, name, parentDirectory });
  console.log(result.directory);
};

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Scaffolding failed",
    );
    process.exitCode = 1;
  }
}
