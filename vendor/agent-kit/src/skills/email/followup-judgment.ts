/**
 * Shared follow-up judgment (§16/§17) — used by BOTH email-read and
 * imessage-read so "who's waiting on a reply from me" is decided the same way
 * across channels. Pure functions, no I/O: the read agents get consistent
 * mechanical signals and the persona makes the final, nuanced call.
 *
 * The governing rule (the owner's): surface *individual* unanswered asks worth a
 * nudge, but NEVER manufacture a reminder for a time-sensitive operational ask
 * that's already moot — a missed "can you open the back door" is not a to-do.
 */
import type {
  AskKind,
  AskSignals,
  Worthiness,
  WorthinessInput,
} from "./followup-judgment/types.js";

// Real-time asks that are moot once hours pass (or were handled in person). A
// missed one must NEVER become a follow-up reminder — this is the explicit
// "don't nag about 'open the back door'" carve-out.
const EPHEMERAL_PATTERNS: readonly RegExp[] = [
  /\b(open|unlock|lock|close|shut|get)\b.{0,24}\b(door|gate|garage|buzzer|building)\b/i,
  /\bare you (home|there|around|up|awake|coming|outside|free right now)\b/i,
  /\b(running|i'?m|we'?re) (late|behind|close|almost)\b/i,
  /\bon (my|the) way\b/i,
  /\bomw\b/i,
  /\bbe there in\b/i,
  /\bin (\d+|a few|five|ten|fifteen|twenty|a couple) ?(min|mins|minutes|sec|secs)\b/i,
  /\bright (now|there)\b/i,
  /\b(i'?m|we'?re) (here|outside|downstairs|at the door)\b/i,
  /\bcan you (grab|bring|pick up|let .{0,15}in|come (down|out|over|get))\b/i,
  /\bwhat'?s the (door|wifi|gate|building|garage) ?code\b/i,
];

const QUESTION_STARTERS =
  /^\s*(who|what|when|where|why|how|which|can|could|would|will|do|does|did|are|is|should|any chance|wanna|want to|you (free|around|up|able))\b/i;
const REQUEST_MARKERS =
  /\b(please|can you|could you|would you|mind (if|you)|let me know|send me|call me|text me|need you to|need your|when you get a chance|whenever you can|get back to me|lmk|following up|circling back|checking in|any update|thoughts\?)\b/i;
const SCHEDULING_MARKERS =
  /\b(what time|when are you|are you free|you around|you available|available|let'?s (meet|grab|schedule)|catch up|grab (lunch|dinner|coffee|drinks|a bite)|schedule|calendar|this (week|weekend)|next week|book a)\b/i;
const SOCIAL_ONLY =
  /^\s*(hey+|hi+|hello|yo+|sup|good (morning|night|evening)|thanks?|thank you|ty|congrats|congratulations|happy (birthday|new year)|lol|haha|nice|cool|ok(ay)?|👍|❤️|🙏|😂|love you|miss you)[\s!.,]*$/i;

// Content-shape classification (ephemeral/social handled by the caller first).
function classifyAsk(t: string): AskKind {
  if (SCHEDULING_MARKERS.test(t)) return "scheduling";
  if (REQUEST_MARKERS.test(t)) return "request";
  if (t.includes("?") || QUESTION_STARTERS.test(t)) return "question";
  return "fyi";
}

/**
 * Classify the ask in a single inbound message body (the *latest* inbound
 * message in a thread/chat). Ephemeral wins over everything — a stale operational
 * ask should read as ephemeral even if it's phrased as a question.
 */
export function analyzeAsk(text: string): AskSignals {
  const t = (text ?? "").trim();
  if (t === "") return { isAsk: false, askKind: "fyi", ephemeral: false };
  if (EPHEMERAL_PATTERNS.some((re) => re.test(t))) {
    return { isAsk: true, askKind: "ephemeral_ops", ephemeral: true };
  }
  if (SOCIAL_ONLY.test(t)) {
    return { isAsk: false, askKind: "social", ephemeral: false };
  }

  const askKind = classifyAsk(t);
  const isAsk = askKind === "question" || askKind === "request"
    || askKind === "scheduling";
  return { isAsk, askKind, ephemeral: false };
}

const HOURS_PER_DAY = 24;
const STALE_DAYS = 30;
const DAY_LABEL_THRESHOLD_HOURS = 48;
// An unanswered ask older than this is almost always moot; surfacing it reads as
// noise, not diligence.
const STALE_HOURS = HOURS_PER_DAY * STALE_DAYS;

function ageLabel(hours: number): string {
  if (hours < DAY_LABEL_THRESHOLD_HOURS) return `${Math.round(hours)}h`;
  return `${Math.round(hours / HOURS_PER_DAY)}d`;
}

/**
 * Should the owner be nudged that this person is waiting on them? Conservative by
 * design — the deterministic layer only returns `suggest: true` for a clear,
 * direct, individual ask; the read agent can still surface a borderline item
 * with the `reason` as context.
 */
export function followupWorthiness(i: WorthinessInput): Worthiness {
  if (!i.unanswered) return { suggest: false, reason: "already answered" };
  if (i.senderKind !== "individual") {
    return {
      suggest: false,
      reason: `${i.senderKind} sender — not a personal ask`,
    };
  }
  if (i.signals.ephemeral || i.signals.askKind === "ephemeral_ops") {
    return {
      suggest: false,
      reason:
        "time-sensitive/operational — moot once stale or handled in person",
    };
  }
  if (!i.signals.isAsk) {
    return { suggest: false, reason: "no question or request — FYI/social" };
  }
  if (i.recipientRole === "cc") {
    return { suggest: false, reason: "you were only cc'd — not the addressee" };
  }
  if (i.recipientRole === "group") {
    return {
      suggest: false,
      reason: "group thread — not addressed to you directly",
    };
  }
  if (i.ageHours > STALE_HOURS) {
    return {
      suggest: false,
      reason: `unanswered ${
        Math.round(i.ageHours / HOURS_PER_DAY)
      }d — likely stale`,
    };
  }
  return {
    suggest: true,
    reason: `individual ${i.signals.askKind}, unanswered ${
      ageLabel(i.ageHours)
    }`,
  };
}
