import { IsolationFloorError } from "../core/errors";
import type { DataClassification, IsolationLevel } from "../core/types";
import type { PlacementRequest } from "./types";

const LEVELS: readonly IsolationLevel[] = [
  "declarative",
  "in-process",
  "process",
  "container",
  "remote",
];

const CLASSIFICATIONS: readonly DataClassification[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];

const maximumIsolation = (
  left: IsolationLevel,
  right: IsolationLevel,
): IsolationLevel =>
  LEVELS.indexOf(left) >= LEVELS.indexOf(right) ? left : right;

export const requiredIsolation = (
  request: PlacementRequest,
): IsolationLevel => {
  let floor = request.schemaMinimum;
  const confidential = CLASSIFICATIONS.indexOf(request.observesClassification)
    >= CLASSIFICATIONS.indexOf("confidential");
  if (
    request.securityContext.securityCritical
    || confidential
    || !request.trustedComputingBase
  ) floor = maximumIsolation(floor, "process");
  return floor;
};

export const assertIsolation = (request: PlacementRequest): void => {
  const floor = requiredIsolation(request);
  if (LEVELS.indexOf(request.requestedIsolation) < LEVELS.indexOf(floor)) {
    throw new IsolationFloorError(request.requestedIsolation, floor);
  }
  if (
    !request.trustedComputingBase
    && (request.requestedIsolation === "declarative"
      || request.requestedIsolation === "in-process")
  ) throw new IsolationFloorError(request.requestedIsolation, "process");
};
