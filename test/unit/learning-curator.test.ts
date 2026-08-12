import { describe, expect, it } from "bun:test";
import { LearnSkillAuthor } from "../../src/learning/curator/index";

describe("LearnSkillAuthor", () => {
  it("activates immediately outside regulated posture", async () => {
    const author = new LearnSkillAuthor({
      propose: async () => {
        throw new Error("unused");
      },
    });
    const result = await author.author({
      name: "notes",
      source: " remember this ",
      posture: "standard",
    });
    expect(result.activation).toBe("active");
    expect(result.skill.lifecycle).toBe("active");
    expect(result.skill.markdown).toContain("remember this");
  });

  it("authors regulated skills through proposals", async () => {
    const author = new LearnSkillAuthor({
      propose: async () => "proposal-1",
    });
    const result = await author.author({
      name: "notes",
      source: "regulated material",
      posture: "regulated",
    });
    expect(result).toEqual({
      skill: expect.objectContaining({
        name: "notes",
        lifecycle: "candidate",
      }),
      activation: "proposal",
      proposalId: "proposal-1",
    });
    await expect(
      author.author({ name: "", source: "x", posture: "standard" }),
    ).rejects.toThrow("name and source");
  });
});
