#!/usr/bin/env bun

import * as Effect from "effect/Effect";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  auditEvolutionProductionAcceptance,
  decodeEvolutionProductionAcceptanceManifest,
  makeFileEvolutionAcceptanceReader,
} from "../src/learning/evolution/index";

const usage =
  "usage: bun run evolution:acceptance -- <manifest.json> <runtime-state-root>";

const main = async (arguments_: readonly string[]): Promise<void> => {
  const [manifestPath, runtimeStateRoot] = arguments_;
  if (manifestPath === undefined || runtimeStateRoot === undefined) {
    throw new Error(usage);
  }
  const source = await readFile(manifestPath, "utf8");
  const input: unknown = JSON.parse(source);
  const manifest = await Effect.runPromise(
    decodeEvolutionProductionAcceptanceManifest(manifestPath, input),
  );
  const reader = await Effect.runPromise(
    makeFileEvolutionAcceptanceReader(runtimeStateRoot),
  );
  const report = await Effect.runPromise(
    auditEvolutionProductionAcceptance(manifest, reader),
  );
  console.log(JSON.stringify(report, undefined, 2));
  if (!report.passed) process.exitCode = 1;
};

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : usage);
    process.exitCode = 1;
  }
}
