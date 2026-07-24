import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EvolutionNotFoundError } from "../errors";
import { EvolutionEvaluationReport } from "../model/index";
import { EvolutionEvaluationReportStore } from "../services";
import type { EvolutionEvaluationReportStoreShape } from "../types";
import { decodeJson, encodeJson } from "./codec";
import {
  containedPath,
  fileExists,
  readText,
  writeTextImmutable,
} from "./files";

const reportFile = (root: string, id: string) =>
  containedPath(root, "reports", `${id}.json`);

export const makeEvolutionEvaluationReportStore = (
  root: string,
): EvolutionEvaluationReportStoreShape => ({
  save: Effect.fn("EvolutionEvaluationReportStore.save")(function*(
    report: EvolutionEvaluationReport,
  ) {
    const filePath = yield* reportFile(root, report.id);
    const source = yield* encodeJson(
      EvolutionEvaluationReport,
      filePath,
      report,
    );
    yield* writeTextImmutable(filePath, source);
    return report;
  }),
  get: Effect.fn("EvolutionEvaluationReportStore.get")(function*(id) {
    const filePath = yield* reportFile(root, id);
    if (!(yield* fileExists(filePath))) {
      return yield* EvolutionNotFoundError.make({
        artifact: "evolution-evaluation-report",
        id,
      });
    }
    return yield* readText(filePath).pipe(
      Effect.flatMap((source) =>
        decodeJson(EvolutionEvaluationReport, filePath, source)
      ),
    );
  }),
});

export const EvolutionEvaluationReportStoreLive = (root: string) =>
  Layer.succeed(
    EvolutionEvaluationReportStore,
    makeEvolutionEvaluationReportStore(root),
  );
