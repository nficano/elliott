import { describe, expect, it } from "bun:test";
import {
  makeGitHubRegistry,
  parseRegistry,
} from "../../../src/install/registry";
import { InstallError } from "../../../src/install/types";

describe("parseRegistry", () => {
  it("splits owner/repo and rejects malformed values", () => {
    expect(parseRegistry("nficano/skills")).toEqual({
      owner: "nficano",
      repo: "skills",
    });
    expect(() => parseRegistry("noslash")).toThrow(InstallError);
    expect(() => parseRegistry("/repo")).toThrow(InstallError);
    expect(() => parseRegistry("owner/")).toThrow(InstallError);
  });
});

describe("makeGitHubRegistry", () => {
  it("lists parsable tags and skips junk refs", async () => {
    const headers: string[] = [];
    const registry = makeGitHubRegistry("acme", "skills", {
      token: "tok",
      fetch: (async (_url, init) => {
        headers.push(String(
          new Headers(init?.headers).get("authorization"),
        ));
        return Response.json([
          { ref: "refs/tags/fetch/v1.2.3" },
          { ref: "refs/tags/not-a-semver" },
          { ref: "refs/tags/ssh/v2.0.0" },
          { ref: 12 },
        ], { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await registry.listTags()).toEqual([
      { name: "fetch", version: "1.2.3", tag: "fetch/v1.2.3" },
      { name: "ssh", version: "2.0.0", tag: "ssh/v2.0.0" },
    ]);
    expect(headers[0]).toBe("Bearer tok");
  });

  it("fails closed on HTTP errors, non-arrays, and oversized listings", async () => {
    await expect(
      makeGitHubRegistry("a", "b", {
        fetch: (async () =>
          new Response("no", { status: 500 })) as unknown as typeof fetch,
      }).listTags(),
    ).rejects.toThrow(/tag listing failed: 500/);

    await expect(
      makeGitHubRegistry("a", "b", {
        fetch: (async () =>
          Response.json({ refs: [] }, {
            status: 200,
          })) as unknown as typeof fetch,
      }).listTags(),
    ).rejects.toThrow(/not an array/);

    const huge = Array.from({ length: 20_001 }, (_, index) => ({
      ref: `refs/tags/x/v1.0.${index}`,
    }));
    await expect(
      makeGitHubRegistry("a", "b", {
        fetch: (async () =>
          Response.json(huge, { status: 200 })) as unknown as typeof fetch,
      }).listTags(),
    ).rejects.toThrow(/too many refs/);
  });

  it("fetches tarball bytes and fails on HTTP errors", async () => {
    const registry = makeGitHubRegistry("acme", "skills", {
      fetch: (async (url) => {
        if (String(url).includes("tar.gz")) {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        }
        return new Response("[]", { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await registry.fetchTarball("fetch/v1.0.0")).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await expect(
      makeGitHubRegistry("a", "b", {
        fetch: (async () =>
          new Response("no", { status: 404 })) as unknown as typeof fetch,
      }).fetchTarball("x/v1.0.0"),
    ).rejects.toThrow(/tarball fetch/);
  });
});
