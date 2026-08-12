import { describe, expect, it } from "bun:test";
import { digest, snapshotId } from "../../src/core/brands";
import { planPromptCache } from "../../src/model/prompt-cache";
import { RouteTableStore } from "../../src/model/routetable";
import { assemblePrompt } from "../../src/prompt/index";
import {
  makeCatalogEntry,
  makeProviderState,
  makeRouteContext,
} from "../helpers";

describe("G13 prompt-cache stability and residency", () => {
  it("caches only residency-safe stable segments and forks on route change", () => {
    const catalog = makeCatalogEntry("model", "public-cloud", [
      "text",
      "prompt-caching",
    ]);
    const provider = makeProviderState("cloud", [catalog], {
      ...makeProviderState().residency,
      provider: "cloud",
      egress: "declared",
      maximumClassification: "internal",
    });
    const route = new RouteTableStore().resolve({
      profile: "fast",
      effectiveClassification: "internal",
      requiredCapabilities: ["text"],
    }, makeRouteContext(provider, "standard")).candidates[0];
    expect(route).toBeDefined();
    if (route === undefined) return;
    const prompt = assemblePrompt(snapshotId("snapshot"), [
      {
        purpose: "constitution",
        source: "kernel",
        digest: digest("constitution"),
        trust: "system",
        securityTags: [],
        classification: "internal",
        content: "policy",
      },
      {
        purpose: "evidence",
        source: "web",
        digest: digest("evidence"),
        trust: "untrusted",
        securityTags: [],
        classification: "confidential",
        content: "private",
      },
    ]);
    const plan = planPromptCache(prompt, route);
    expect(plan.directives[0]).toMatchObject({ cache: true, noStore: false });
    expect(plan.directives[1]).toMatchObject({ cache: false, noStore: true });
    expect(
      plan.directives.filter((directive) => directive.cache).every(
        (directive) => directive.classification === "internal",
      ),
    ).toBe(true);
    const changed = planPromptCache(prompt, { ...route, model: "other-model" });
    expect(changed.identity).not.toBe(plan.identity);
  });
});
