import * as Effect from "effect/Effect";
import path from "node:path";
import { EvolutionNotFoundError } from "../errors";
import { EvolutionBaselineReport } from "../model/index";
import type { EvolutionBaselineReportStoreShape } from "../types";
import { decodeJson, encodeJson } from "./codec";
import {
  containedPath,
  fileExists,
  listFiles,
  readText,
  writeTextImmutable,
} from "./files";

const baselineReportFile = (root: string, id: string) =>
  containedPath(root, "baseline-reports", `${id}.json`);

const readReport = (filePath: string) =>
  readText(filePath).pipe(
    Effect.flatMap((source) =>
      decodeJson(EvolutionBaselineReport, filePath, source)
    ),
  );

export const makeEvolutionBaselineReportStore = (
  root: string,
): EvolutionBaselineReportStoreShape => ({
  save: Effect.fn("EvolutionBaselineReportStore.save")(function*(
    report: EvolutionBaselineReport,
  ) {
    const filePath = yield* baselineReportFile(root, report.id);
    const source = yield* encodeJson(
      EvolutionBaselineReport,
      filePath,
      report,
    );
    yield* writeTextImmutable(filePath, source);
    return report;
  }),
  get: Effect.fn("EvolutionBaselineReportStore.get")(function*(id) {
    const filePath = yield* baselineReportFile(root, id);
    if (!(yield* fileExists(filePath))) {
      return yield* EvolutionNotFoundError.make({
        artifact: "evolution-baseline-report",
        id,
      });
    }
    return yield* readReport(filePath);
  }),
  listForRun: Effect.fn("EvolutionBaselineReportStore.listForRun")(function*(
    runId,
  ) {
    const directory = yield* containedPath(root, "baseline-reports");
    if (!(yield* fileExists(directory))) return [];
    const names = yield* listFiles(directory);
    const reports = yield* Effect.forEach(
      names
        .filter((name) => path.extname(name) === ".json")
        .toSorted((left, right) => left.localeCompare(right)),
      (name) =>
        containedPath(directory, name).pipe(
          Effect.flatMap(readReport),
        ),
      { concurrency: 1 },
    );
    return reports.filter((report) => report.runId === runId);
  }),
});
