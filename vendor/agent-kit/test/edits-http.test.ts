import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { applyAnchoredEdits, fencePaths } from "../src/core/edits.js";
import { highestSatisfying, satisfies } from "../src/host/registry/semver.js";
import { IntegrationError, makeHttp } from "../src/integrations/http.js";

// Run an Effect that must fail and return the typed error (the `._unsafeUnwrapErr()` analog).
async function runFail<A, E>(eff: Effect.Effect<A, E>): Promise<E> {
  const result = await Effect.runPromise(Effect.result(eff));
  if (Result.isSuccess(result)) {
    throw new Error(
      `expected failure, got success: ${JSON.stringify(result.success)}`,
    );
  }
  return result.failure;
}

describe("anchored edits (TDD §9.4)", () => {
  test("unique anchors apply in order; absent/ambiguous aborts the whole set", () => {
    const ok = applyAnchoredEdits("a b c", [
      { find: "a", replace: "x" },
      { find: "x b", replace: "y" },
    ]);
    expect(ok).toEqual({ ok: true, content: "y c" });

    const absent = applyAnchoredEdits("a b c", [
      { find: "a", replace: "x" },
      { find: "zz", replace: "y" },
    ]);
    expect(absent.ok).toBe(false);
    if (!absent.ok) {
      expect(absent.failure).toEqual({ kind: "absent", index: 1 });
    }

    const ambiguous = applyAnchoredEdits("dup dup", [{
      find: "dup",
      replace: "x",
    }]);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.failure).toEqual({
        kind: "ambiguous",
        index: 0,
        count: 2,
      });
    }

    expect(
      applyAnchoredEdits("abc", [{ find: "b", replace: "$&" }]),
    ).toEqual({ ok: true, content: "a$&c" });
    const thrice = applyAnchoredEdits("dup dup dup", [{
      find: "dup",
      replace: "x",
    }]);
    expect(thrice.ok).toBe(false);
    if (!thrice.ok) {
      expect(thrice.failure).toEqual({
        kind: "ambiguous",
        index: 0,
        count: 3,
      });
    }
  });

  test("path fencing: prefix allowlist, no traversal, empty allowlist fences everything", () => {
    expect(fencePaths(["apps/www/x.md", "apps/www/y/z.ts"], ["apps/www"]))
      .toEqual([]);
    expect(fencePaths(["apps/api/x.ts"], ["apps/www"])).toEqual([
      "apps/api/x.ts",
    ]);
    expect(fencePaths(["apps/www/../api/x"], ["apps/www"])).toEqual([
      "apps/www/../api/x",
    ]);
    expect(fencePaths(["/etc/passwd"], ["apps/www"])).toEqual(["/etc/passwd"]);
    expect(fencePaths(["anything"], [])).toEqual(["anything"]);
    // "apps/www-evil" must not slip past the "apps/www" prefix
    expect(fencePaths(["apps/www-evil/x"], ["apps/www"])).toEqual([
      "apps/www-evil/x",
    ]);
  });
});

describe("integrations http core", () => {
  const res = (status: number, body: string) =>
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });

  test("error taxonomy: http / parse / network tags with retryability", async () => {
    const http404 = makeHttp("svc", {
      fetchImpl: async () => res(404, "nope"),
      sleep: async () => {},
    });
    const e404 = await runFail(http404.fetchJson({ url: "https://x" }, Schema.Unknown));
    expect(e404.tag).toBe("svc.http");
    expect(e404.status).toBe(404);
    expect(e404.retryable).toBe(false);

    const httpBadJson = makeHttp("svc", {
      fetchImpl: async () => res(200, "{oops"),
      sleep: async () => {},
    });
    expect((await runFail(httpBadJson.fetchJson({ url: "https://x" }, Schema.Unknown))).tag)
      .toBe("svc.parse");

    let networkCalls = 0;
    const networkSleeps: number[] = [];
    const httpDown = makeHttp("svc", {
      fetchImpl: async () => {
        networkCalls++;
        throw new Error("ECONNREFUSED");
      },
      random: () => 0,
      sleep: async (milliseconds) => {
        networkSleeps.push(milliseconds);
      },
    });
    const eDown = await runFail(httpDown.fetchText({ url: "https://x" }));
    expect(eDown.tag).toBe("svc.network");
    expect(eDown.retryable).toBe(true);
    expect(networkCalls).toBe(3);
    expect(networkSleeps).toEqual([125, 250]);
  });

  test("transient 5xx retries with jittered exponential timing then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const flaky = makeHttp("svc", {
      fetchImpl: async () => (++calls < 3
        ? res(503, "unavailable")
        : res(200, "{\"ok\":true}")),
      random: () => 0,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });
    const out = await Effect.runPromise(
      flaky.fetchJson({ url: "https://x" }, Schema.Struct({ ok: Schema.Boolean })),
    );
    expect(out).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([125, 250]);
  });

  test("retry conditions and attempt count exclude 4xx and parse failures", async () => {
    let transientCalls = 0;
    const transientSleeps: number[] = [];
    const transient = makeHttp("svc", {
      fetchImpl: async () => {
        transientCalls++;
        return res(transientCalls === 1 ? 429 : 502, "unavailable");
      },
      random: () => 0,
      sleep: async (milliseconds) => {
        transientSleeps.push(milliseconds);
      },
    });
    const transientError = await runFail(
      transient.fetchText({ url: "https://x" }),
    );
    expect(transientError.status).toBe(502);
    expect(transientCalls).toBe(3);
    expect(transientSleeps).toEqual([125, 250]);

    let clientCalls = 0;
    const clientSleeps: number[] = [];
    const clientError = makeHttp("svc", {
      fetchImpl: async () => {
        clientCalls++;
        return res(400, "bad request");
      },
      random: () => 0,
      sleep: async (milliseconds) => {
        clientSleeps.push(milliseconds);
      },
    });
    expect(
      (await runFail(clientError.fetchText({ url: "https://x" }))).status,
    ).toBe(400);
    expect(clientCalls).toBe(1);
    expect(clientSleeps).toEqual([]);

    let parseCalls = 0;
    const invalidJson = makeHttp("svc", {
      fetchImpl: async () => {
        parseCalls++;
        return res(200, "{oops");
      },
      random: () => 0,
      sleep: async () => {},
    });
    expect(
      (await runFail(invalidJson.fetchJson({ url: "https://x" }, Schema.Unknown))).tag,
    ).toBe("svc.parse");
    expect(parseCalls).toBe(1);
  });

  test("schema decoding maps invalid response shapes to parse errors", async () => {
    const Payload = Schema.Struct({ ok: Schema.Boolean });
    const valid = makeHttp("svc", {
      fetchImpl: async () => res(200, "{\"ok\":true,\"ignored\":1}"),
    });
    expect(
      await Effect.runPromise(valid.fetchJson({ url: "https://x" }, Payload)),
    ).toEqual({ ok: true });

    const invalid = makeHttp("svc", {
      fetchImpl: async () => res(200, "{\"ok\":\"yes\"}"),
    });
    const error = await runFail(
      invalid.fetchJson({ url: "https://x" }, Payload),
    );
    expect(error.tag).toBe("svc.parse");
    expect(error).toBeInstanceOf(IntegrationError);
  });

  test("response bodies are clipped on http errors", async () => {
    const big = makeHttp("svc", {
      fetchImpl: async () => res(400, "x".repeat(1000)),
      sleep: async () => {},
    });
    const e = await runFail(big.fetchJson({ url: "https://x" }, Schema.Unknown));
    expect(e.message.length).toBeLessThan(400);
    expect(e).toBeInstanceOf(IntegrationError);
  });
});

describe("semver ranges (TDD §7)", () => {
  test("the useful subset", () => {
    expect(satisfies("1.2.3", "*")).toBe(true);
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "1.2.3")).toBe(false);
    expect(satisfies("1.9.0", "^1.2")).toBe(true);
    expect(satisfies("2.0.0", "^1.2")).toBe(false);
    expect(satisfies("0.1.9", "^0.1.2")).toBe(true);
    expect(satisfies("0.2.0", "^0.1.2")).toBe(false);
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfies("2.5.1", "2")).toBe(true);
    expect(satisfies("2.5.1", "2.x")).toBe(true);
    expect(satisfies("3.0.0", "2")).toBe(false);
    expect(satisfies("1.5.0", ">=1.2")).toBe(true);
    expect(satisfies("1.1.0", ">=1.2")).toBe(false);
    expect(highestSatisfying(["1.0.0", "1.4.0", "2.0.0"], "^1")).toBe("1.4.0");
    expect(highestSatisfying(["1.0.0"], "^2")).toBeUndefined();
  });
});

// ── github skill / draft_pr glue (stubbed GitHub) ──

import type { ToolCtx } from "../src/core/agent/types.js";
import type { ServiceGet } from "../src/core/di/services.js";
import type { Github } from "../src/integrations/github.js";
import { githubSkill } from "../src/skills/github/github.js";

/** No runtime services in this unit test; the skill under test never reaches for one. */
const noServices: ServiceGet = (tag) => {
  throw new Error(`test: no service ${tag.key}`);
};

describe("github skill — draft_pr (TDD §9.4)", () => {
  const toolCtx: ToolCtx = {
    traceId: "t",
    sessionId: "s",
    conversationKey: "c",
    origin: "internal",
  };

  async function activate(files: Record<string, string>, opened: unknown[]) {
    const gh: Github = {
      getFile: (path) =>
        Effect.succeed({ path, content: files[path] ?? "", sha: "sha" }),
      createIssue: () => Effect.succeed({ number: 1, url: "u" }),
      commentIssue: () => Effect.succeed(undefined),
      openDraftPullRequest: (input) => {
        opened.push(input);
        return Effect.succeed({
          number: 7,
          url: "https://pr/7",
          branch: input.branch,
        });
      },
    };
    const skill = githubSkill({ github: () => gh, now: () => 1234 });
    const config = Schema.decodeUnknownSync(skill.manifest.configSchema)({
      enabled: true,
      repo: "o/r",
      allowed_prefixes: ["docs"],
    });
    return skill.activate({
      config,
      get: noServices,
      tier: "standard",
      profile: {},
      secrets: { token: "tok" },
    });
  }

  const run = (active: Awaited<ReturnType<typeof activate>>, args: unknown) =>
    Effect.runPromise(
      active.writeTools![0]!.execute(args, toolCtx).pipe(
        Effect.match({
          onSuccess: (s) => JSON.parse(s) as Record<string, unknown>,
          onFailure: (e) => ({ error: String(e) }),
        }),
      ),
    );

  test("edits + creates land on a stamped branch as a draft PR", async () => {
    const opened: {
      branch: string;
      files: { path: string; content: string; }[];
      base: string;
    }[] = [];
    const active = await activate({ "docs/a.md": "hello world" }, opened);
    const out = await run(active, {
      title: "Fix docs",
      branchSuffix: "fix-docs",
      edits: [{ path: "docs/a.md", find: "hello", replace: "hi" }],
      creates: [{ path: "docs/new.md", content: "fresh" }],
    });
    expect(out.url).toBe("https://pr/7");
    expect(String(out.ref)).toContain("agent/proposal/fix-docs-");
    expect(opened[0]!.base).toBe("main");
    expect(opened[0]!.files).toEqual([
      { path: "docs/a.md", content: "hi world" },
      { path: "docs/new.md", content: "fresh" },
    ]);
  });

  test("fencing rejects out-of-allowlist paths; ambiguous anchors abort the set", async () => {
    const opened: unknown[] = [];
    const active = await activate({ "docs/a.md": "dup dup" }, opened);
    const fenced = await run(active, {
      title: "x",
      branchSuffix: "x",
      edits: [{ path: "src/evil.ts", find: "a", replace: "b" }],
      creates: [],
    });
    expect(String(fenced.error)).toContain("allowed prefixes");

    const ambiguous = await run(active, {
      title: "x",
      branchSuffix: "x",
      edits: [{ path: "docs/a.md", find: "dup", replace: "y" }],
      creates: [],
    });
    expect(String(ambiguous.error)).toContain("aborted");
    expect(opened).toHaveLength(0); // nothing ever reached GitHub
  });
});
