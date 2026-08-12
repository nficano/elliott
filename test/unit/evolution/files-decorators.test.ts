import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
  loadFileEvolutionDefaultSources,
  makeActiveEvolutionPromptDecorator,
  makeActiveEvolutionSkillDecorator,
  makeEvolutionRuntimeTurnTargetResolver,
} from "../../../src/learning/evolution/application/files";

const root = path.resolve(import.meta.dir, "../../..");

describe("evolution file decorators and default sources", () => {
  it("loads defaultSources from the repository target catalog", async () => {
    const sources = await loadFileEvolutionDefaultSources(root);
    expect(sources["core/tool/description-catalog"]).toEqual(["synthetic"]);
  });

  it("resolves turn targets for prompt segments", async () => {
    const resolve = await makeEvolutionRuntimeTurnTargetResolver(root, {
      contentForTarget: () => undefined,
    });
    const targets = resolve();
    expect(
      targets.some((item) =>
        item.targetRef === "core/prompt/elliott-interaction-profile"
      ),
    ).toBe(true);
  });

  it("decorates prompt content from the active revision when present", async () => {
    const decorate = await makeActiveEvolutionPromptDecorator(root, {
      contentForTarget: (ref) =>
        ref === "core/prompt/elliott-interaction-profile"
          ? { digest: "sha256:active", content: "active prompt" }
          : undefined,
    });
    const personaPath = path.join(root, "assets/prompts/elliott.md");
    expect(decorate(personaPath, "baseline")()).toBe("active prompt");
    expect(decorate("/var/unrelated.md", "baseline")()).toBe("baseline");
  });

  it("returns an empty skill decorator when no skill targets exist", async () => {
    const decorate = await makeActiveEvolutionSkillDecorator(root, {
      contentForTarget: () => undefined,
    });
    expect(decorate()).toBe("");
  });
});
