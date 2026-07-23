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
  MergeRequest,
  MergeResult,
  MergeTicket,
} from "./types";

const makeFrameId = Brand.nominal<FrameId>();

export class KernelContextManager implements ContextManager {
  readonly #frames = new Map<FrameId, ContextFrame>();
  readonly #records: RecordAppender;
  readonly #sanitizer: FrameSanitizer;
  readonly #standard: boolean;
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
    const result = this.#resolveMerge(request);
    return Object.freeze({ id: newId("merge"), result });
  }

  async #resolveMerge(request: MergeRequest): Promise<MergeResult> {
    const source = this.frame(request.sourceFrame);
    const target = this.frame(request.targetFrame);
    if (
      request.ordering === "revision-dependent"
      && request.sourceRevision !== source.revision
    ) return { type: "stale-merge" };
    const requiresSanitizer = maximumClassification([
          source.classification,
          target.classification,
        ]) === source.classification
      && source.classification !== target.classification;
    let output = request.rawOutput;
    if (requiresSanitizer) {
      const decision = await this.#sanitizer.sanitize(request);
      if (!decision.approved || decision.output === undefined) {
        return { type: "blocked-declassification" };
      }
      output = decision.output;
    }
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
        sanitized: requiresSanitizer,
      },
    });
    return { type: "merged", output };
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
