import type {
  CapabilityRequest,
  ComponentRef,
  PrincipalId,
} from "../core/types";
import type { RecordAppender } from "../core/waist/types";
import type { FrameId } from "../security/ifc/types";

export interface ScheduledJob {
  readonly id: string;
  readonly principal: PrincipalId;
  readonly agent: ComponentRef;
  readonly requestedCapabilities: readonly CapabilityRequest[];
  readonly runAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface LeasedJob {
  readonly job: ScheduledJob;
  readonly owner: string;
  readonly leaseUntil: string;
}

export interface ScheduledJobStore {
  schedule(job: ScheduledJob): Promise<void>;
  leaseDue(
    now: Date,
    owner: string,
    limit: number,
  ): Promise<readonly LeasedJob[]>;
  complete(jobId: string, owner: string): Promise<void>;
  release(jobId: string, owner: string): Promise<void>;
}

export interface SchedulerAuthorityResolver {
  resolve(
    principal: PrincipalId,
    capabilities: readonly CapabilityRequest[],
  ): Promise<boolean>;
}

export interface FreshFrameFactory {
  create(): FrameId;
}

export interface ScheduledJobExecutor {
  execute(job: ScheduledJob, frame: FrameId): Promise<void>;
}

export interface SchedulerDependencies {
  readonly store: ScheduledJobStore;
  readonly authority: SchedulerAuthorityResolver;
  readonly frames: FreshFrameFactory;
  readonly executor: ScheduledJobExecutor;
  readonly records: RecordAppender;
}

export interface ScheduledRunResult {
  readonly jobId: string;
  readonly type: "completed" | "blocked-no-authority" | "failed";
  readonly frame?: FrameId;
}
