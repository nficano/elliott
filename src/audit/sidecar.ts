import type { RecordDraft, RecordEvent } from "../core/waist/types";
import { AuditLog } from "./log";
import type { AuditCrossLink, AuditSnapshot } from "./types";

export class AppendOnlyAuditSidecar {
  constructor(readonly log: AuditLog) {}

  append(draft: RecordDraft): Promise<RecordEvent> {
    return this.log.append(draft);
  }

  crossLink(): Promise<AuditCrossLink> {
    return this.log.crossLink();
  }

  snapshot(): AuditSnapshot {
    return this.log.snapshot();
  }
}
