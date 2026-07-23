import type {
  AskSignals,
  RecipientRole,
  SenderKind,
  Worthiness,
} from "../followup-judgment/types.js";

/** One inbox message's decision-relevant fields (from Gmail metadata). */
export interface RawEmail {
  readonly id: string;
  readonly threadId: string;
  readonly from: string; // raw From header ("Name <a@b.com>")
  readonly to: string; // raw To header
  readonly cc: string; // raw Cc header
  readonly subject: string;
  readonly snippet: string; // short plaintext preview
  readonly listUnsubscribe: string; // List-Unsubscribe header value ("" if absent)
  readonly listId: string; // List-Id header value ("" if absent)
  readonly precedence: string; // Precedence header value ("" if absent)
  readonly autoSubmitted: string; // Auto-Submitted header value ("" if absent)
}

/** A thread whose most recent message is inbound — a follow-up candidate. */
export interface ThreadCandidate {
  readonly latest: RawEmail; // the most recent inbound message in the thread
  readonly unanswered: boolean; // newest message in the thread is NOT from the owner
  readonly ageHours: number; // hours since that latest inbound message
}

export type CleanupKind =
  | "policy_update"
  | "review_request"
  | "marketing"
  | "automated_noise";

export interface CleanupItem {
  readonly kind: CleanupKind;
  readonly sender: string; // normalized sender key
  readonly emailIds: string[];
  readonly count: number;
  readonly sampleSubjects: string[];
  readonly listUnsubscribeUrl: string | null;
  /** ≥2 near-identical subjects from this sender — the "sent 5 times" case. */
  readonly duplicateCluster: boolean;
}

export interface FollowupItem {
  readonly threadId: string;
  readonly from: string;
  readonly senderKind: SenderKind;
  readonly recipientRole: RecipientRole;
  readonly forwarded: boolean;
  readonly subject: string;
  readonly snippet: string;
  readonly ageHours: number;
  readonly ask: AskSignals;
  readonly worthiness: Worthiness;
}

export interface Bucket {
  kind: CleanupKind;
  sender: string;
  emailIds: string[];
  subjects: string[];
  templates: Set<string>;
  listUnsubscribeUrl: string | null;
}
