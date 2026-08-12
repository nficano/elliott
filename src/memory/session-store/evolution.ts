import type { Database } from "bun:sqlite";
import type {
  ComponentUseEvidence,
  EvaluationLabelEvidence,
  FeedbackEvidence,
  ModelSelectionEvidence,
  SessionRunEvidence,
  ToolCallEvidence,
  ToolFailureEvidenceSummary,
} from "../types";

const EVOLUTION_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, agent_ref TEXT NOT NULL, disposition TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT)",
  "CREATE TABLE IF NOT EXISTS component_uses (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, component_ref TEXT NOT NULL, component_digest TEXT NOT NULL, operation TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, requested_tool TEXT, selected_tool TEXT, schema_digest TEXT NOT NULL, arguments_digest TEXT, result_digest TEXT, latency_milliseconds INTEGER NOT NULL, error_tag TEXT, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, target_ref TEXT NOT NULL, kind TEXT NOT NULL, evidence_digest TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS evaluation_labels (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, evaluator_ref TEXT NOT NULL, rubric_digest TEXT NOT NULL, score REAL NOT NULL, confidence REAL NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS model_selections (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, route_digest TEXT NOT NULL, usage_reference TEXT NOT NULL, created_at TEXT NOT NULL)",
];

export class SessionEvolutionStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
    for (const statement of EVOLUTION_SCHEMA) database.run(statement);
  }

  recordRun(run: SessionRunEvidence): void {
    this.#database.run(
      "INSERT INTO runs (id, session_id, snapshot_id, agent_ref, disposition, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        run.id,
        run.sessionId,
        run.snapshotId,
        run.agentRef,
        run.disposition,
        run.startedAt,
        run.finishedAt ?? null,
      ],
    );
  }

  finishRun(
    runId: string,
    disposition: SessionRunEvidence["disposition"],
    finishedAt: string,
  ): void {
    this.#database.run(
      "UPDATE runs SET disposition = ?, finished_at = ? WHERE id = ?",
      [disposition, finishedAt, runId],
    );
  }

  recordComponentUse(use: ComponentUseEvidence): void {
    this.#database.run(
      "INSERT INTO component_uses (id, run_id, component_ref, component_digest, operation, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        use.id,
        use.runId,
        use.componentRef,
        use.componentDigest,
        use.operation,
        use.outcome,
        use.createdAt,
      ],
    );
  }

  recordToolCall(call: ToolCallEvidence): void {
    this.#database.run(
      "INSERT INTO tool_calls (id, run_id, requested_tool, selected_tool, schema_digest, arguments_digest, result_digest, latency_milliseconds, error_tag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        call.id,
        call.runId,
        call.requestedTool ?? null,
        call.selectedTool ?? null,
        call.schemaDigest,
        call.argumentsDigest ?? null,
        call.resultDigest ?? null,
        call.latencyMilliseconds,
        call.errorTag ?? null,
        call.createdAt,
      ],
    );
  }

  recordFeedback(feedback: FeedbackEvidence): void {
    this.#database.run(
      "INSERT INTO feedback (id, run_id, target_ref, kind, evidence_digest, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        feedback.id,
        feedback.runId,
        feedback.targetRef,
        feedback.kind,
        feedback.evidenceDigest,
        feedback.createdAt,
      ],
    );
  }

  recordEvaluationLabel(label: EvaluationLabelEvidence): void {
    this.#database.run(
      "INSERT INTO evaluation_labels (id, run_id, evaluator_ref, rubric_digest, score, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        label.id,
        label.runId,
        label.evaluatorRef,
        label.rubricDigest,
        label.score,
        label.confidence,
        label.source,
        label.createdAt,
      ],
    );
  }

  recordModelSelection(selection: ModelSelectionEvidence): void {
    this.#database.run(
      "INSERT INTO model_selections (id, run_id, route_digest, usage_reference, created_at) VALUES (?, ?, ?, ?, ?)",
      [
        selection.id,
        selection.runId,
        selection.routeDigest,
        selection.usageReference,
        selection.createdAt,
      ],
    );
  }

  feedbackForTarget(targetRef: string): readonly FeedbackEvidence[] {
    return this.#database.query<FeedbackEvidence, [string]>(
      "SELECT id, run_id AS runId, target_ref AS targetRef, kind, evidence_digest AS evidenceDigest, created_at AS createdAt FROM feedback WHERE target_ref = ? ORDER BY created_at",
    ).all(targetRef);
  }

  toolCallsForRun(runId: string): readonly ToolCallEvidence[] {
    return this.#database.query<ToolCallEvidence, [string]>(
      "SELECT id, run_id AS runId, requested_tool AS requestedTool, selected_tool AS selectedTool, schema_digest AS schemaDigest, arguments_digest AS argumentsDigest, result_digest AS resultDigest, latency_milliseconds AS latencyMilliseconds, error_tag AS errorTag, created_at AS createdAt FROM tool_calls WHERE run_id = ? ORDER BY created_at",
    ).all(runId);
  }

  toolFailureSummaryForTarget(
    targetRef: string,
    targetDigest: string,
  ): ToolFailureEvidenceSummary {
    const join = [
      "FROM tool_calls AS tc",
      "JOIN component_uses AS cu",
      "ON cu.run_id = tc.run_id",
      "AND cu.operation = COALESCE(tc.selected_tool, tc.requested_tool)",
      "WHERE cu.component_ref = ?",
      "AND cu.component_digest = ?",
    ].join(" ");
    const total = this.#database.query<
      { readonly count: number; },
      [string, string]
    >(`SELECT COUNT(DISTINCT tc.id) AS count ${join}`).get(
      targetRef,
      targetDigest,
    );
    const failurePredicate = [
      "AND (tc.error_tag IS NOT NULL",
      "OR cu.outcome = 'failure'",
      "OR (tc.requested_tool IS NOT NULL",
      "AND (tc.selected_tool IS NULL",
      "OR tc.selected_tool <> tc.requested_tool)))",
    ].join(" ");
    const failures = this.#database.query<
      ToolCallEvidence,
      [string, string]
    >(
      [
        "SELECT DISTINCT tc.id, tc.run_id AS runId,",
        "tc.requested_tool AS requestedTool,",
        "tc.selected_tool AS selectedTool,",
        "tc.schema_digest AS schemaDigest,",
        "tc.arguments_digest AS argumentsDigest,",
        "tc.result_digest AS resultDigest,",
        "tc.latency_milliseconds AS latencyMilliseconds,",
        "tc.error_tag AS errorTag, tc.created_at AS createdAt",
        join,
        failurePredicate,
        "ORDER BY tc.created_at",
      ].join(" "),
    ).all(targetRef, targetDigest);
    return {
      failures,
      totalCalls: total?.count ?? 0,
    };
  }

  componentUsesForRun(runId: string): readonly ComponentUseEvidence[] {
    return this.#database.query<ComponentUseEvidence, [string]>(
      "SELECT id, run_id AS runId, component_ref AS componentRef, component_digest AS componentDigest, operation, outcome, created_at AS createdAt FROM component_uses WHERE run_id = ? ORDER BY created_at",
    ).all(runId);
  }

  evaluationLabelsForRun(
    runId: string,
  ): readonly EvaluationLabelEvidence[] {
    return this.#database.query<EvaluationLabelEvidence, [string]>(
      "SELECT id, run_id AS runId, evaluator_ref AS evaluatorRef, rubric_digest AS rubricDigest, score, confidence, source, created_at AS createdAt FROM evaluation_labels WHERE run_id = ? ORDER BY created_at",
    ).all(runId);
  }

  modelSelectionsForRun(
    runId: string,
  ): readonly ModelSelectionEvidence[] {
    return this.#database.query<ModelSelectionEvidence, [string]>(
      "SELECT id, run_id AS runId, route_digest AS routeDigest, usage_reference AS usageReference, created_at AS createdAt FROM model_selections WHERE run_id = ? ORDER BY created_at",
    ).all(runId);
  }

  runsForSession(sessionId: string): readonly SessionRunEvidence[] {
    return this.#database.query<SessionRunEvidence, [string]>(
      "SELECT id, session_id AS sessionId, snapshot_id AS snapshotId, agent_ref AS agentRef, disposition, started_at AS startedAt, finished_at AS finishedAt FROM runs WHERE session_id = ? ORDER BY started_at",
    ).all(sessionId);
  }
}
