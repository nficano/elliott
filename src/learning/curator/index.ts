import type {
  CuratorAction,
  LearnedSkill,
  LearnProposalAuthor,
  LearnSkillInput,
  LearnSkillResult,
} from "../types";

const ARCHIVE_AFTER_DAYS = 90;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const DAY_IN_MILLISECONDS = HOURS_PER_DAY
  * MINUTES_PER_HOUR
  * SECONDS_PER_MINUTE
  * MILLISECONDS_PER_SECOND;

export class SkillCurator {
  maintain(
    skills: readonly LearnedSkill[],
    now = new Date(),
  ): readonly CuratorAction[] {
    return skills.filter((skill) => this.#shouldArchive(skill, now)).map((
      skill,
    ) =>
      Object.freeze({
        skill: skill.name,
        type: "archive",
        recoverable: true,
      })
    );
  }

  #shouldArchive(skill: LearnedSkill, now: Date): boolean {
    if (
      skill.createdBy !== "agent" || skill.pinned
      || skill.lifecycle === "archived"
    ) {
      return false;
    }
    const age = now.getTime() - new Date(skill.lastUsedAt).getTime();
    return age >= ARCHIVE_AFTER_DAYS * DAY_IN_MILLISECONDS;
  }
}

export class LearnSkillAuthor {
  readonly #proposals: LearnProposalAuthor;

  constructor(proposals: LearnProposalAuthor) {
    this.#proposals = proposals;
  }

  async author(input: LearnSkillInput): Promise<LearnSkillResult> {
    if (input.name.length === 0 || input.source.trim().length === 0) {
      throw new Error("Learned skills require a name and source material");
    }
    const skill: LearnedSkill = Object.freeze({
      name: input.name,
      markdown: `---\nname: ${input.name}\n---\n\n${input.source.trim()}\n`,
      createdBy: "agent",
      pinned: false,
      lifecycle: input.posture === "regulated" ? "candidate" : "active",
      lastUsedAt: new Date().toISOString(),
      hasExecutableOverlay: false,
    });
    if (input.posture !== "regulated") {
      return Object.freeze({ skill, activation: "active" });
    }
    const proposalId = await this.#proposals.propose(skill);
    return Object.freeze({ skill, activation: "proposal", proposalId });
  }
}
