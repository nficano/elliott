export type AskKind =
  | "question"
  | "request"
  | "scheduling"
  | "ephemeral_ops"
  | "social"
  | "fyi";
export type SenderKind = "individual" | "business" | "automated";
export type Channel = "email" | "imessage";
export type RecipientRole = "direct" | "cc" | "group";

export interface AskSignals {
  /** Contains an actual question or request aimed at the reader. */
  readonly isAsk: boolean;
  readonly askKind: AskKind;
  /** Time-sensitive/operational — loses all value once stale. */
  readonly ephemeral: boolean;
}

export interface WorthinessInput {
  readonly channel: Channel;
  readonly signals: AskSignals;
  readonly ageHours: number;
  readonly senderKind: SenderKind;
  readonly recipientRole: RecipientRole;
  /** The most recent message in the thread/chat is inbound (not from the owner). */
  readonly unanswered: boolean;
}

export interface Worthiness {
  readonly suggest: boolean;
  readonly reason: string;
}
