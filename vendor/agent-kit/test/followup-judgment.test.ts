import { describe, expect, test } from "bun:test";
import {
  analyzeAsk,
  followupWorthiness,
} from "../src/skills/email/followup-judgment.js";
import type { AskSignals } from "../src/skills/email/followup-judgment/types.js";

describe("analyzeAsk", () => {
  test("plain question", () => {
    const a = analyzeAsk("Are you free to review the deck before Thursday?");
    expect(a.isAsk).toBe(true);
    expect(a.askKind).toBe("scheduling"); // "are you free" is scheduling-shaped
    expect(a.ephemeral).toBe(false);
  });

  test("direct request", () => {
    const a = analyzeAsk(
      "Hey, can you send me the signed W-9 when you get a chance?",
    );
    expect(a.isAsk).toBe(true);
    expect(a.askKind).toBe("request");
    expect(a.ephemeral).toBe(false);
  });

  test("bare question mark counts as a question", () => {
    const a = analyzeAsk("Did the wire go through?");
    expect(a.isAsk).toBe(true);
    expect(["question", "request"]).toContain(a.askKind);
  });

  test("ephemeral: open the back door → ephemeral_ops, wins over question shape", () => {
    const a = analyzeAsk("can you open the back door?");
    expect(a.ephemeral).toBe(true);
    expect(a.askKind).toBe("ephemeral_ops");
  });

  test("ephemeral: are you home", () => {
    expect(analyzeAsk("are you home rn").ephemeral).toBe(true);
  });

  test("ephemeral: omw / running late", () => {
    expect(analyzeAsk("omw, running late by 10 min").ephemeral).toBe(true);
    expect(analyzeAsk("I'm outside").ephemeral).toBe(true);
  });

  test("social only → not an ask", () => {
    expect(analyzeAsk("thanks!").isAsk).toBe(false);
    expect(analyzeAsk("Happy birthday!").isAsk).toBe(false);
    expect(analyzeAsk("hey").askKind).toBe("social");
  });

  test("statement/FYI → not an ask", () => {
    const a = analyzeAsk("Just landed, all good.");
    expect(a.isAsk).toBe(false);
    expect(a.askKind).toBe("fyi");
  });

  test("empty", () => {
    expect(analyzeAsk("").isAsk).toBe(false);
    expect(analyzeAsk(" ".repeat(3)).isAsk).toBe(false);
  });
});

describe("followupWorthiness", () => {
  const question: AskSignals = {
    isAsk: true,
    askKind: "question",
    ephemeral: false,
  };
  const base = {
    channel: "imessage" as const,
    signals: question,
    ageHours: 5,
    senderKind: "individual" as const,
    recipientRole: "direct" as const,
    unanswered: true,
  };

  test("individual direct unanswered question → suggest", () => {
    const w = followupWorthiness(base);
    expect(w.suggest).toBe(true);
    expect(w.reason).toContain("individual");
  });

  test("answered → no", () => {
    expect(followupWorthiness({ ...base, unanswered: false }).suggest).toBe(
      false,
    );
  });

  test("business sender → no", () => {
    expect(followupWorthiness({ ...base, senderKind: "business" }).suggest)
      .toBe(false);
  });

  test("automated sender → no", () => {
    expect(followupWorthiness({ ...base, senderKind: "automated" }).suggest)
      .toBe(false);
  });

  test("ephemeral ops → no (the 'open the back door' rule)", () => {
    const ephemeral: AskSignals = {
      isAsk: true,
      askKind: "ephemeral_ops",
      ephemeral: true,
    };
    const w = followupWorthiness({ ...base, signals: ephemeral });
    expect(w.suggest).toBe(false);
    expect(w.reason).toMatch(/moot|operational|time-sensitive/i);
  });

  test("cc'd → no (not the addressee)", () => {
    expect(followupWorthiness({ ...base, recipientRole: "cc" }).suggest).toBe(
      false,
    );
  });

  test("group thread → no", () => {
    expect(followupWorthiness({ ...base, recipientRole: "group" }).suggest)
      .toBe(false);
  });

  test("FYI/social → no", () => {
    const fyi: AskSignals = { isAsk: false, askKind: "fyi", ephemeral: false };
    expect(followupWorthiness({ ...base, signals: fyi }).suggest).toBe(false);
  });

  test("very stale (>30d) → no", () => {
    expect(followupWorthiness({ ...base, ageHours: 24 * 45 }).suggest).toBe(
      false,
    );
  });

  test("recent age labeled in hours, older in days", () => {
    expect(followupWorthiness({ ...base, ageHours: 6 }).reason).toContain("6h");
    expect(followupWorthiness({ ...base, ageHours: 24 * 3 }).reason).toContain(
      "3d",
    );
  });
});
