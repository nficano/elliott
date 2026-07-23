import type {
  ComponentManifest,
  DataClassification,
  SnapshotId,
} from "../core/types";
import type {
  InteractionProfileInput,
  PromptAssembly,
  PromptPurpose,
  PromptSegment,
} from "./types";

const PURPOSE_ORDER: readonly PromptPurpose[] = [
  "constitution",
  "runtime",
  "operator",
  "workspace",
  "interaction-profile",
  "task",
  "skill",
  "memory",
  "evidence",
];

const CLASSIFICATION_ORDER: readonly DataClassification[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];

export const maximumClassification = (
  values: readonly DataClassification[],
): DataClassification =>
  values.reduce<DataClassification>(
    (highest, value) =>
      CLASSIFICATION_ORDER.indexOf(value)
          > CLASSIFICATION_ORDER.indexOf(highest)
        ? value
        : highest,
    "public",
  );

export const assemblePrompt = (
  snapshot: SnapshotId,
  segments: readonly PromptSegment[],
): PromptAssembly => {
  const ordered = [...segments].sort((left, right) =>
    PURPOSE_ORDER.indexOf(left.purpose) - PURPOSE_ORDER.indexOf(right.purpose)
  );
  const cacheBreakpoint = ordered.findIndex((segment) =>
    segment.purpose === "memory" || segment.purpose === "evidence"
  );
  const breakpoint = cacheBreakpoint === -1 ? ordered.length : cacheBreakpoint;
  return Object.freeze({
    snapshot,
    segments: Object.freeze(ordered),
    stablePrefix: Object.freeze(ordered.slice(0, breakpoint)),
    volatileSuffix: Object.freeze(ordered.slice(breakpoint)),
    cacheBreakpoint: breakpoint,
    effectiveClassification: maximumClassification(
      ordered.flatMap((segment) => [
        segment.classification,
        ...segment.securityTags.map((tag) => tag.classification),
      ]),
    ),
  });
};

export const interactionProfileSegment = (
  input: InteractionProfileInput,
): PromptSegment =>
  Object.freeze({
    purpose: "interaction-profile",
    source: input.source,
    digest: input.digest,
    trust: "authenticated",
    securityTags: Object.freeze([]),
    classification: "internal",
    content: input.content,
  });

export const assertZeroAuthorityInteractionProfile = (
  manifest: ComponentManifest,
): void => {
  if (
    manifest.schema.kind !== "interaction-profile"
    || manifest.requestedCapabilities.length > 0
  ) {
    throw new Error(
      "Interaction profiles must carry zero executable authority",
    );
  }
};

export type * from "./types";
