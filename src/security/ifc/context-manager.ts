import * as Brand from "effect/Brand";
import { scopeId } from "../../core/brands";
import { newId } from "../../core/digest";
import type { DataClassification } from "../../core/types";
import type { RecordAppender } from "../../core/waist/types";
import { maximumClassification } from "../../prompt/index";
import type {
  ContextFrame,
  ContextManager,
  FrameId,
  FrameSanitizer,
  FrameWireInput,
  MergeApplyInput,
  MergeRequest,
  MergeResult,
  MergeTicket,
} from "./types";

const makeFrameId = Brand.nominal<FrameId>();
const DEFAULT_MERGE_LIMIT = 128;

export const requiresDeclassification = (
  source: DataClassification,
  target: DataClassification,
): boolean =>
  maximumClassification([source, target]) === source
  && source !== target;

export const resolveMergeOrdering = (
  ordering: MergeRequest["ordering"],
  appendSafe: boolean,
  revisions: { readonly source: number; readonly current: number; },
): "commutative" | "revision-dependent" | "stale" => {
  const effectiveOrdering = ordering === "commutative" && appendSafe
    ? "commutative"
    : "revision-dependent";
  if (
    effectiveOrdering === "revision-dependent"
    && revisions.source !== revisions.current
  ) return "stale";
  return effectiveOrdering;
};

export class KernelContextManager implements ContextManager {
  readonly #frames = new Map<FrameId, ContextFrame>();
  readonly #records: RecordAppender;
  readonly #sanitizer: FrameSanitizer;
  readonly #standard: boolean;
  readonly #applyQueues = new Map<FrameId, Promise<void>>();
  readonly #mergeCounts = new Map<FrameId, number>();
  #active: FrameId;

  constructor(
    records: RecordAppender,
    sanitizer: FrameSanitizer,
    standard = true,
  ) {
    this.#records = records;
    this.#sanitizer = sanitizer;
    this.#standard = standard;
    this.#active = this.#createFrame(undefined, "internal");
  }

  get activeFrame(): FrameId {
    return this.#active;
  }

  frame(id: FrameId): ContextFrame {
    const frame = this.#frames.get(id);
    if (frame === undefined) throw new Error(`Unknown frame ${id}`);
    return frame;
  }

  fork(requestedClassification: DataClassification, reason: string): FrameId {
    void reason;
    const parent = this.frame(this.#active);
    const requested = this.#classification(requestedClassification);
    const id = this.#createFrame(
      parent.id,
      maximumClassification([parent.classification, requested]),
    );
    this.#active = id;
    return id;
  }

  wire(input: FrameWireInput): ContextFrame {
    const frame = this.frame(input.frame);
    const classification = this.#classification(maximumClassification([
      frame.classification,
      input.sourceClassification,
      ...input.tags.map((tag) => tag.classification),
    ]));
    const next = Object.freeze({
      ...frame,
      classification,
      messages: Object.freeze([...frame.messages, ...input.messages]),
      securityTags: Object.freeze([...frame.securityTags, ...input.tags]),
      revision: frame.revision + 1,
    });
    this.#frames.set(input.frame, next);
    return next;
  }

  async merge(request: MergeRequest): Promise<MergeTicket> {
    const count = (this.#mergeCounts.get(request.sourceFrame) ?? 0) + 1;
    if (count > DEFAULT_MERGE_LIMIT) {
      return this.#ticket(
        Promise.resolve({ type: "blocked-declassification" }),
      );
    }
    this.#mergeCounts.set(request.sourceFrame, count);
    const result = this.#resolveMerge(request);
    return this.#ticket(result);
  }

  async #resolveMerge(request: MergeRequest): Promise<MergeResult> {
    const source = this.frame(request.sourceFrame);
    const target = this.frame(request.targetFrame);
    const requiresSanitizer = requiresDeclassification(
      source.classification,
      target.classification,
    );
    let output = request.rawOutput;
    let appendSafe = false;
    if (requiresSanitizer) {
      const decision = await this.#sanitizer.sanitize(request);
      if (!decision.approved || decision.output === undefined) {
        return { type: "blocked-declassification" };
      }
      output = decision.output;
      appendSafe = decision.appendSafe ?? false;
    }
    return this.#enqueueApply({
      request,
      output,
      sanitized: requiresSanitizer,
      appendSafe,
    });
  }

  async #enqueueApply(input: MergeApplyInput): Promise<MergeResult> {
    const { request } = input;
    const previous = this.#applyQueues.get(request.targetFrame)
      ?? Promise.resolve();
    const result = previous.then(() => this.#apply(input));
    this.#applyQueues.set(
      request.targetFrame,
      result.then(() => undefined).catch(() => undefined),
    );
    return result;
  }

  async #apply(input: MergeApplyInput): Promise<MergeResult> {
    const { request, output, sanitized, appendSafe } = input;
    const source = this.frame(request.sourceFrame);
    const ordering = resolveMergeOrdering(request.ordering, appendSafe, {
      source: request.sourceRevision,
      current: source.revision,
    });
    if (ordering === "stale") return { type: "stale-merge" };
    const target = this.frame(request.targetFrame);
    this.wire({
      frame: target.id,
      messages: [{ role: "tool", content: output }],
      tags: [],
      sourceClassification: target.classification,
    });
    await this.#records.append({
      type: "frame.merge",
      scope: { level: "session", id: scopeId(target.id) },
      durability: "observational",
      classification: target.classification,
      payload: {
        source: source.id,
        target: target.id,
        sanitized,
      },
    });
    return { type: "merged", output };
  }

  #ticket(result: Promise<MergeResult>): MergeTicket {
    const id = newId("merge");
    return Object.freeze({ id, mergeId: id, result });
  }

  #classification(value: DataClassification): DataClassification {
    return this.#standard ? "internal" : value;
  }

  #createFrame(
    parentId: FrameId | undefined,
    classification: DataClassification,
  ): FrameId {
    const id = makeFrameId(newId("frame"));
    const common = {
      id,
      classification: this.#classification(classification),
      messages: Object.freeze([]),
      securityTags: Object.freeze([]),
      revision: 0,
    };
    const frame = parentId === undefined
      ? Object.freeze(common)
      : Object.freeze({ ...common, parentId });
    this.#frames.set(id, frame);
    return id;
  }
}
