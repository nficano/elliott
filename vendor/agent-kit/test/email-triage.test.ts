import { describe, expect, test } from "bun:test";
import {
  buildCleanup,
  buildFollowups,
  cleanupKind,
  isForwarded,
  isPolicyUpdate,
  isReviewRequest,
  normalizeSender,
  recipientRole,
  senderKind,
  subjectTemplate,
} from "../src/skills/email/email-triage.js";
import type {
  RawEmail,
  ThreadCandidate,
} from "../src/skills/email/email-triage/types.js";

const SELF = "nficano@gmail.com";

function email(p: Partial<RawEmail>): RawEmail {
  return {
    id: p.id ?? "m1",
    threadId: p.threadId ?? "t1",
    from: p.from ?? "Someone <someone@example.com>",
    to: p.to ?? SELF,
    cc: p.cc ?? "",
    subject: p.subject ?? "",
    snippet: p.snippet ?? "",
    listUnsubscribe: p.listUnsubscribe ?? "",
    listId: p.listId ?? "",
    precedence: p.precedence ?? "",
    autoSubmitted: p.autoSubmitted ?? "",
  };
}

describe("senderKind", () => {
  test("human local-part, no bulk headers → individual", () => {
    expect(senderKind(email({ from: "Jane Doe <jane.doe@gmail.com>" }))).toBe(
      "individual",
    );
  });
  test("no-reply → automated", () => {
    expect(senderKind(email({ from: "GitHub <noreply@github.com>" }))).toBe(
      "automated",
    );
  });
  test("notifications@ → automated", () => {
    expect(senderKind(email({ from: "notifications@google.com" }))).toBe(
      "automated",
    );
  });
  test("digits-heavy local-part → automated", () => {
    expect(senderKind(email({ from: "bounce-12345@mandrillapp.com" }))).toBe(
      "automated",
    );
  });
  test("human-ish but bulk (List-Unsubscribe) → business", () => {
    expect(
      senderKind(
        email({
          from: "Bon Appetit <editor@bonappetit.com>",
          listUnsubscribe: "<https://x/u>",
        }),
      ),
    ).toBe("business");
  });
  test("Auto-Submitted: auto-generated → automated", () => {
    expect(
      senderKind(
        email({ from: "helpdesk@corp.com", autoSubmitted: "auto-generated" }),
      ),
    ).toBe("automated");
  });
});

describe("recipientRole", () => {
  test("in To → direct", () => {
    expect(recipientRole(email({ to: `A <${SELF}>, b@x.com` }), SELF)).toBe(
      "direct",
    );
  });
  test("only in Cc → cc", () => {
    expect(recipientRole(email({ to: "boss@x.com", cc: SELF }), SELF)).toBe(
      "cc",
    );
  });
  test("neither (bcc/list) → group", () => {
    expect(recipientRole(email({ to: "list@x.com", cc: "" }), SELF)).toBe(
      "group",
    );
  });
});

describe("isForwarded", () => {
  test("Fwd: subject", () => {
    expect(isForwarded(email({ subject: "Fwd: contract" }))).toBe(true);
    expect(isForwarded(email({ subject: "FW: contract" }))).toBe(true);
  });
  test("forwarded-message body marker", () => {
    expect(
      isForwarded(email({ snippet: "---------- Forwarded message ---------" })),
    ).toBe(true);
  });
  test("normal subject → not forwarded", () => {
    expect(isForwarded(email({ subject: "quick question" }))).toBe(false);
  });
});

describe("policy + review detection", () => {
  test("privacy policy update", () => {
    expect(
      isPolicyUpdate(email({ subject: "We've updated our Privacy Policy" })),
    ).toBe(true);
    expect(
      isPolicyUpdate(email({ subject: "Changes to our Terms of Service" })),
    ).toBe(true);
  });
  test("review solicitation", () => {
    expect(
      isReviewRequest(email({ subject: "How did we do? Leave us a review" })),
    ).toBe(true);
    expect(isReviewRequest(email({ snippet: "Please rate your recent order" })))
      .toBe(true);
  });
  test("a genuine personal email is neither", () => {
    const e = email({
      from: "Dad <dad@family.com>",
      subject: "dinner sunday?",
    });
    expect(isPolicyUpdate(e)).toBe(false);
    expect(isReviewRequest(e)).toBe(false);
    expect(cleanupKind(e)).toBeNull();
  });
});

describe("subjectTemplate + duplicate clustering", () => {
  test("Core Web Vitals notices collapse to one template regardless of site", () => {
    const a = subjectTemplate(
      "We're validating your Core Web Vitals issue fixes for site teachmehipaa.com",
    );
    const b = subjectTemplate(
      "We're validating your Core Web Vitals issue fixes for site example.org",
    );
    expect(a).toBe(b);
  });

  test("5 Search Console validations → ONE cleanup item, flagged duplicate, count 5", () => {
    const sites = ["teachmehipaa.com", "a.com", "b.org", "c.io", "d.net"];
    const emails = sites.map((s, i) =>
      email({
        id: `gsc${i}`,
        from: "Search Console <sc-noreply@google.com>",
        subject:
          `We're validating your Core Web Vitals issue fixes for site ${s}`,
      })
    );
    const cleanup = buildCleanup(emails);
    expect(cleanup).toHaveLength(1);
    expect(cleanup[0]!.count).toBe(5);
    expect(cleanup[0]!.duplicateCluster).toBe(true);
    expect(cleanup[0]!.kind).toBe("automated_noise");
    expect(cleanup[0]!.sender).toBe("google.com"); // machine local-part collapses to domain
  });

  test("policy updates route to cleanup as policy_update", () => {
    const cleanup = buildCleanup([
      email({
        id: "p1",
        from: "Slack <feedback@slack.com>",
        subject: "Updates to our Terms of Service",
      }),
    ]);
    expect(cleanup[0]!.kind).toBe("policy_update");
  });

  test("individuals are never cleanup", () => {
    const cleanup = buildCleanup([
      email({
        from: "Sarah <sarah@gmail.com>",
        subject: "can you look at this?",
      }),
    ]);
    expect(cleanup).toHaveLength(0);
  });
});

describe("normalizeSender", () => {
  test("machine → domain, human → full address", () => {
    expect(normalizeSender("billing@stripe.com")).toBe("stripe.com");
    expect(normalizeSender("Jane <jane.doe@gmail.com>")).toBe(
      "jane.doe@gmail.com",
    );
  });
});

describe("buildFollowups", () => {
  function candidate(
    p: Partial<RawEmail>,
    o: Partial<ThreadCandidate> = {},
  ): ThreadCandidate {
    return {
      latest: email(p),
      unanswered: o.unanswered ?? true,
      ageHours: o.ageHours ?? 8,
    };
  }

  test("individual direct unanswered ask → suggested", () => {
    const items = buildFollowups(
      [candidate({
        from: "Mike <mike@gmail.com>",
        to: SELF,
        subject: "quick q",
        snippet: "can you call me tomorrow?",
      })],
      SELF,
    );
    expect(items[0]!.worthiness.suggest).toBe(true);
    expect(items[0]!.senderKind).toBe("individual");
    expect(items[0]!.recipientRole).toBe("direct");
  });

  test("cc'd individual ask → not suggested (context factored)", () => {
    const items = buildFollowups(
      [candidate({
        from: "Mike <mike@gmail.com>",
        to: "someone@x.com",
        cc: SELF,
        snippet: "can you confirm?",
      })],
      SELF,
    );
    expect(items[0]!.recipientRole).toBe("cc");
    expect(items[0]!.worthiness.suggest).toBe(false);
  });

  test("business review-request thread → not suggested", () => {
    const items = buildFollowups(
      [candidate({
        from: "Yelp <noreply@yelp.com>",
        subject: "Rate your visit",
        snippet: "leave us a review",
      })],
      SELF,
    );
    expect(items[0]!.worthiness.suggest).toBe(false);
  });

  test("ephemeral ask (open the back door) that went unanswered → not suggested", () => {
    const items = buildFollowups(
      [candidate({
        from: "Kat <kat@gmail.com>",
        snippet: "can you open the back door?",
      }, { ageHours: 20 })],
      SELF,
    );
    expect(items[0]!.worthiness.suggest).toBe(false);
    expect(items[0]!.worthiness.reason).toMatch(
      /moot|operational|time-sensitive/i,
    );
  });

  test("worthy items sort before unworthy", () => {
    const items = buildFollowups(
      [
        candidate({ from: "Yelp <noreply@yelp.com>", snippet: "rate us" }),
        candidate({
          from: "Mike <mike@gmail.com>",
          to: SELF,
          snippet: "can you send the file?",
        }),
      ],
      SELF,
    );
    expect(items[0]!.worthiness.suggest).toBe(true);
  });
});
