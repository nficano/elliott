import type { DataClassification, GrantHandle } from "../../core/types";
import type { Grant, Invocation } from "../../core/waist/types";
import type { IncrementalScanner } from "../../hotcore/types";

export interface StreamArgumentChunk {
  readonly delta: string;
  readonly complete: boolean;
}

export interface PreparedExecution<Result> {
  readonly planDigest: string;
  readonly commit: (completeArguments: string) => Promise<Result>;
  readonly discard: () => Promise<void>;
}

export interface StreamInspectionResult<Result> {
  readonly status: "pending" | "blocked" | "dispatched";
  readonly result?: Result;
}

export interface BrokerExecutionInput<Result> {
  readonly invocation: Invocation;
  readonly handle: GrantHandle;
  readonly capability: string;
  readonly resource: string;
  readonly frameClassification: DataClassification;
  readonly destinationMaximumClassification: DataClassification;
  readonly arguments: unknown;
  readonly execute: (grant: Grant, input: unknown) => Promise<Result>;
}

export interface BrokeredProviderToolCall<Result>
  extends BrokerExecutionInput<Result>
{
  readonly provider: string;
}

export interface StreamBrokerExecutionInput<Result> {
  readonly invocation: Invocation;
  readonly handle: GrantHandle;
  readonly capability: string;
  readonly resource: string;
  readonly frameClassification: DataClassification;
  readonly destinationMaximumClassification: DataClassification;
  readonly scanner: IncrementalScanner;
  readonly prepare: (grant: Grant) => Promise<PreparedExecution<Result>>;
}
