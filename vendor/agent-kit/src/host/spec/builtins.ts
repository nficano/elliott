import { emailPack } from "../../skills/email/index.js";
import { githubSkill } from "../../skills/github/index.js";
import { remindersSkill } from "../../skills/reminders/index.js";
import { watchSkill } from "../../skills/watch/index.js";
import {
  braveSkill,
  browserSkill,
  firecrawlSkill,
  pageAuditSkill,
  sitemapSkill,
  webpageSkill,
} from "../../skills/web/index.js";
import { youtubeSkill } from "../../skills/youtube/index.js";
import type { Registrable } from "../registry/types.js";

/**
 * Built-in skill ids a spec's `uses:` may name without the consumer passing a
 * registrable (AGENT-SPEC §3.1). Spec id `gmail` maps to the email pack's
 * read/write registrable pair — one import enables both; `permissions:`
 * decides whether the write half materializes.
 */
export function builtinSkillFactories(): Record<string, () => Registrable[]> {
  return {
    browser: () => [browserSkill()],
    brave: () => [braveSkill()],
    firecrawl: () => [firecrawlSkill()],
    webpage: () => [webpageSkill()],
    sitemap: () => [sitemapSkill()],
    "page-audit": () => [pageAuditSkill()],
    github: () => [githubSkill()],
    watch: () => [watchSkill()],
    reminders: () => [remindersSkill()],
    gmail: () => emailPack(),
    youtube: () => [youtubeSkill()],
  };
}

export function builtinSkillIds(): string[] {
  return Object.keys(builtinSkillFactories()).sort();
}

/**
 * Repo path holding each built-in skill's source — the tree the lockfile
 * pins (AGENT-SPEC §1.4). Pack members share their pack dir.
 */
export function builtinSkillTreePath(skill: string): string {
  const packs: Record<string, string> = {
    browser: "src/skills/web",
    brave: "src/skills/web",
    firecrawl: "src/skills/web",
    webpage: "src/skills/web",
    sitemap: "src/skills/web",
    "page-audit": "src/skills/web",
    gmail: "src/skills/email",
  };
  return packs[skill] ?? `src/skills/${skill}`;
}
