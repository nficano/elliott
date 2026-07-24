import * as Effect from "effect/Effect";
import { EvolutionNotFoundError } from "../errors";
import { EvolutionReleaseMonitorReport } from "../model/index";
import type { EvolutionReleaseMonitorReportStoreShape } from "../types";
import { decodeJson, encodeJson } from "./codec";
import {
  containedPath,
  fileExists,
  readText,
  writeTextImmutable,
} from "./files";

const monitorReportFile = (root: string, id: string) =>
  containedPath(root, "release-monitor-reports", `${id}.json`);

export const makeEvolutionReleaseMonitorReportStore = (
  root: string,
): EvolutionReleaseMonitorReportStoreShape => ({
  save: Effect.fn("EvolutionReleaseMonitorReportStore.save")(function*(
    report: EvolutionReleaseMonitorReport,
  ) {
    const filePath = yield* monitorReportFile(root, report.id);
    const source = yield* encodeJson(
      EvolutionReleaseMonitorReport,
      filePath,
      report,
    );
    yield* writeTextImmutable(filePath, source);
    return report;
  }),
  get: Effect.fn("EvolutionReleaseMonitorReportStore.get")(function*(id) {
    const filePath = yield* monitorReportFile(root, id);
    if (!(yield* fileExists(filePath))) {
      return yield* EvolutionNotFoundError.make({
        artifact: "evolution-release-monitor-report",
        id,
      });
    }
    return yield* readText(filePath).pipe(
      Effect.flatMap((source) =>
        decodeJson(EvolutionReleaseMonitorReport, filePath, source)
      ),
    );
  }),
});
