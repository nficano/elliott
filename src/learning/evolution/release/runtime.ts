/* eslint-disable max-lines, max-lines-per-function, complexity, better-max-params/better-max-params */
import * as Effect from "effect/Effect";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { ConfigurationActivationManager } from "../../../config/activation/index";
import type { ConfigurationRevision } from "../../../config/activation/types";
import {
  componentRef,
  digest,
  principalId,
  snapshotId,
} from "../../../core/brands";
import { hashValue } from "../../../core/digest";
import { isJsonRecord } from "../../../providers/http";
import type { EvolutionControlAuthority } from "../cli/types";
import { EvolutionPromotionError } from "../errors";
import {
  EvolutionEvaluationReportIdSchema,
  EvolutionReleaseIdSchema,
  EvolutionRunIdSchema,
} from "../model/index";
import { makeKernelReleaseHooks } from "./activation";
import { promoteEvolutionRelease } from "./promoter";
import { rollbackEvolutionRelease } from "./rollback";
import type {
  EvolutionPromotionInput,
  EvolutionRuntimeReleaseBinding,
  EvolutionRuntimeReleaseControllerInput,
  EvolutionRuntimeTargetRevision,
} from "./types";

const ACTIVE_FILE = "active.json";

const decodeRevision = (
  input: unknown,
  filePath: string,
): EvolutionRuntimeTargetRevision => {
  if (!isJsonRecord(input) || !isJsonRecord(input["revision"])) {
    throw new TypeError(`${filePath} has an invalid revision`);
  }
  const value = input["revision"];
  const targets = input["targets"];
  if (
    typeof value["id"] !== "string"
    || typeof value["digest"] !== "string"
    || !Array.isArray(value["touchedEpochs"])
    || !Array.isArray(value["policyDigests"])
    || typeof value["createdAt"] !== "string"
    || !isJsonRecord(targets)
  ) throw new TypeError(`${filePath} has an invalid revision`);
  const decodedTargets: Record<string, { digest: string; content: string; }> =
    {};
  for (const [targetRef, target] of Object.entries(targets)) {
    if (
      !isJsonRecord(target) || typeof target["digest"] !== "string"
      || typeof target["content"] !== "string"
    ) throw new TypeError(`${filePath} has an invalid target revision`);
    decodedTargets[targetRef] = {
      digest: target["digest"],
      content: target["content"],
    };
  }
  const parentDigest = value["parentDigest"];
  if (parentDigest !== undefined && typeof parentDigest !== "string") {
    throw new TypeError(`${filePath} has an invalid parent digest`);
  }
  return {
    revision: {
      id: value["id"],
      digest: digest(value["digest"]),
      ...(parentDigest !== undefined && {
        parentDigest: digest(parentDigest),
      }),
      touchedEpochs: value["touchedEpochs"].filter(
        (item): item is string => typeof item === "string",
      ),
      policyDigests: value["policyDigests"].filter(
        (item): item is string => typeof item === "string",
      ).map(digest),
      createdAt: value["createdAt"],
    },
    targets: decodedTargets,
  };
};

class RuntimeRevisionStore {
  readonly #root: string;
  readonly #revisions = new Map<string, EvolutionRuntimeTargetRevision>();
  #active: EvolutionRuntimeTargetRevision;

  constructor(root: string, baselineSnapshotId: string) {
    this.#root = path.resolve(root);
    mkdirSync(this.#root, { recursive: true });
    const names = readdirSync(this.#root).filter((name) =>
      name.endsWith(".revision.json")
    );
    for (const name of names) {
      const filePath = path.join(this.#root, name);
      const document = decodeRevision(
        JSON.parse(readFileSync(filePath, "utf8")),
        filePath,
      );
      this.#revisions.set(document.revision.digest, document);
    }
    const activePath = path.join(this.#root, ACTIVE_FILE);
    if (existsSync(activePath)) {
      const activeValue: unknown = JSON.parse(readFileSync(activePath, "utf8"));
      if (
        !isJsonRecord(activeValue)
        || typeof activeValue["revisionDigest"] !== "string"
      ) throw new TypeError(`${activePath} has an invalid active revision`);
      const active = this.#revisions.get(activeValue["revisionDigest"]);
      if (active === undefined) {
        throw new TypeError(`${activePath} references a missing revision`);
      }
      this.#active = active;
      return;
    }
    const revision: ConfigurationRevision = {
      id: `cfg_${crypto.randomUUID()}`,
      digest: hashValue({ baselineSnapshotId, targets: {} }),
      touchedEpochs: [],
      policyDigests: [],
      createdAt: new Date().toISOString(),
    };
    this.#active = { revision, targets: {} };
    this.#save(this.#active);
    this.activate(revision);
  }

  get active(): EvolutionRuntimeTargetRevision {
    return this.#active;
  }

  get(digest: string): EvolutionRuntimeTargetRevision | undefined {
    return this.#revisions.get(digest);
  }

  stage(input: EvolutionPromotionInput): EvolutionRuntimeTargetRevision {
    const content = input.candidate.materializedContent;
    if (content === undefined) {
      throw new TypeError("candidate has no materialized content");
    }
    const targets = {
      ...this.#active.targets,
      [input.run.target.componentRef]: {
        digest: input.candidate.candidateDigest,
        content,
      },
    };
    const revision: ConfigurationRevision = {
      id: `cfg_${input.proposal.id}`,
      digest: hashValue({
        parentDigest: this.#active.revision.digest,
        proposalId: input.proposal.id,
        targets,
      }),
      parentDigest: this.#active.revision.digest,
      touchedEpochs: ["workspace"],
      policyDigests: [],
      createdAt: input.now,
    };
    const existing = this.#revisions.get(revision.digest);
    if (existing !== undefined) return existing;
    const document = { revision, targets };
    this.#save(document);
    return document;
  }

  activate(revision: ConfigurationRevision): void {
    const document = this.#revisions.get(revision.digest);
    if (document === undefined) throw new Error("unknown target revision");
    const temporary = path.join(
      this.#root,
      `${ACTIVE_FILE}.${crypto.randomUUID()}.tmp`,
    );
    writeFileSync(
      temporary,
      `${JSON.stringify({ revisionDigest: revision.digest })}\n`,
      { flag: "wx" },
    );
    renameSync(temporary, path.join(this.#root, ACTIVE_FILE));
    this.#active = document;
  }

  contentForTarget(targetRef: string) {
    return this.#active.targets[targetRef];
  }

  #save(document: EvolutionRuntimeTargetRevision): void {
    const filePath = path.join(
      this.#root,
      `${
        Buffer.from(document.revision.digest).toString("base64url")
      }.revision.json`,
    );
    if (!existsSync(filePath)) {
      writeFileSync(filePath, `${JSON.stringify(document, undefined, 2)}\n`, {
        flag: "wx",
      });
    }
    this.#revisions.set(document.revision.digest, document);
  }
}

const snapshotForRevision = (
  input: EvolutionRuntimeReleaseControllerInput,
  revisionStore: RuntimeRevisionStore,
  baseSnapshotId: string,
  revision: ConfigurationRevision,
) => {
  const base = input.snapshots.get(snapshotId(baseSnapshotId));
  if (base === undefined) throw new Error("release Snapshot is unavailable");
  const document = revisionStore.get(revision.digest);
  if (document === undefined) {
    throw new Error("release revision is unavailable");
  }
  const activeTargets = Object.fromEntries(
    Object.entries(document.targets).map(([ref, target]) => [
      ref,
      target.digest,
    ]),
  );
  const evolutionTargetRefs = new Set([
    ...Object.keys(revisionStore.active.targets),
    ...Object.keys(document.targets),
  ]);
  return {
    configurationDigest: hashValue({
      base: base.configurationDigest,
      revision: revision.digest,
      activeTargets,
    }),
    registryDigest: base.registryDigest,
    components: [
      ...base.components.filter((item) => !evolutionTargetRefs.has(item.ref)),
      ...Object.entries(document.targets).map(([ref, target]) => ({
        ref: componentRef(ref),
        manifestDigest: hashValue({ ref, immutableTarget: true }),
        configDigest: hashValue(target.digest),
      })),
    ],
    configuration: {
      ...base.configuration,
      evolutionRevisionDigest: revision.digest,
      evolutionActiveTargets: activeTargets,
    },
    previous: base.id,
  };
};

export const makeRuntimeEvolutionReleaseBinding = (
  input: EvolutionRuntimeReleaseControllerInput,
): EvolutionRuntimeReleaseBinding => {
  const currentSnapshot = input.currentSnapshotId();
  if (currentSnapshot === undefined) {
    throw new Error("runtime release binding requires an active Snapshot");
  }
  const revisionStore = new RuntimeRevisionStore(
    input.stateRoot,
    currentSnapshot,
  );
  const activation = new ConfigurationActivationManager(
    revisionStore.active.revision,
    {
      evaluateSecurityDelta: async () => ({
        widenedCapabilities: [],
        narrowedCapabilities: [],
        classificationChanged: false,
      }),
      startCandidate: async () => {},
      healthCheck: async (revision) =>
        revisionStore.get(revision.digest) !== undefined,
      commit: async ({ revision }) => revisionStore.activate(revision),
      discard: async () => {},
    },
  );
  const hooks = makeKernelReleaseHooks({
    activation,
    snapshots: input.snapshots,
    epochs: input.epochs,
    records: input.records,
    workspaceId: input.workspaceId,
    candidateRevision: (promotion) => revisionStore.stage(promotion).revision,
    revisionByDigest: (digest) => revisionStore.get(digest)?.revision,
    candidateSnapshot: (promotion, revision) =>
      snapshotForRevision(
        input,
        revisionStore,
        promotion.run.baselineSnapshotId,
        revision,
      ),
    rollbackSnapshot: (release, revision) =>
      snapshotForRevision(
        input,
        revisionStore,
        release.snapshotId,
        revision,
      ),
    canary: input.canary,
  });
  const controller = {
    promote: (proposalId: string, authority: EvolutionControlAuthority) =>
      Effect.gen(function*() {
        const proposal = input.proposals.get(proposalId);
        if (proposal === undefined || proposal.evolution === undefined) {
          return yield* EvolutionPromotionError.make({
            proposalId,
            stage: "runtime-load",
            reason: "approved evolution Proposal is unavailable",
          });
        }
        const run = yield* input.runs.get(
          EvolutionRunIdSchema.make(proposal.evolution.runId),
        );
        const candidates = yield* input.candidates.listForRun(run.id);
        const candidate = candidates.find((item) =>
          item.candidateDigest === proposal.evolution?.candidateDigest
        );
        if (candidate === undefined) {
          return yield* EvolutionPromotionError.make({
            proposalId,
            stage: "runtime-load",
            reason: "Proposal candidate is unavailable",
          });
        }
        const report = yield* input.reports.get(
          EvolutionEvaluationReportIdSchema.make(
            proposal.evolution.evaluationReportId,
          ),
        );
        const previousRelease = yield* input.releases.activeForTarget(
          run.target.componentRef,
        ).pipe(Effect.option);
        const activeTargetDigest =
          revisionStore.contentForTarget(run.target.componentRef)?.digest
            ?? run.target.baselineDigest;
        const release = yield* promoteEvolutionRelease(
          {
            proposal,
            report,
            run,
            candidate,
            promoterId: principalId(authority.principalId),
            activeTargetDigest,
            now: new Date().toISOString(),
            promoterCapabilities: ["release.promote"],
            ...(previousRelease._tag === "Some" && {
              previousRelease: previousRelease.value,
            }),
          },
          hooks,
          {
            releases: input.releases,
            runs: input.runs,
          },
        );
        input.publishSnapshotId(release.snapshotId);
        yield* Effect.promise(() =>
          input.notify?.(
            `Evolution release ${release.id} promoted ${release.targetRef}.`,
          ).catch(() => undefined) ?? Promise.resolve()
        );
        return release;
      }),
    rollback: (releaseId: string, authority: EvolutionControlAuthority) =>
      Effect.gen(function*() {
        const release = yield* input.releases.get(
          EvolutionReleaseIdSchema.make(releaseId),
        );
        const activeTargetDigest =
          revisionStore.contentForTarget(release.targetRef)?.digest
            ?? release.targetDigest;
        const rolledBack = yield* rollbackEvolutionRelease(
          {
            release,
            principalId: principalId(authority.principalId),
            now: new Date().toISOString(),
            capabilities: ["release.rollback"],
            activeTargetDigest,
          },
          hooks,
          {
            releases: input.releases,
            runs: input.runs,
          },
        );
        input.publishSnapshotId(rolledBack.snapshotId);
        yield* Effect.promise(() =>
          input.notify?.(
            `Evolution release ${release.id} rolled back through ${rolledBack.id}.`,
          ).catch(() => undefined) ?? Promise.resolve()
        );
        return rolledBack;
      }),
  };
  return {
    targets: {
      contentForTarget: (targetRef) =>
        revisionStore.contentForTarget(targetRef),
    },
    controller,
  };
};
