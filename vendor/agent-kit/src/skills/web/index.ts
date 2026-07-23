import type { Registrable } from "../../host/registry/types.js";
import { browserSkill } from "./browser.js";
import { pageAuditSkill } from "./page-audit.js";
import { braveSkill, firecrawlSkill, webpageSkill } from "./search.js";
import { sitemapSkill } from "./sitemap.js";

export { browserSkill } from "./browser.js";
export { BrowserClient } from "./browser/client.js";
export { auditHtml, isRealIsoDate, pageAuditSkill } from "./page-audit.js";
export {
  braveSkill,
  firecrawlSkill,
  stripHtml,
  webpageSkill,
} from "./search.js";
export {
  extractLocs,
  isSitemapIndex,
  mapLimit,
  resolveSitemap,
  sitemapSkill,
  sitemapUrlsFromRobots,
} from "./sitemap.js";
export type {
  AnchorAudit,
  ImageHygiene,
  JsonLdAudit,
  PageAudit,
} from "./types.js";

/**
 * The generic web pack (§18/§21; CAPABILITIES-TDD §9.1). A consumer enables the
 * subset it wants via config — nothing is enabled by default (§5). brave /
 * firecrawl / webpage also register as `web-search@1` / `page-fetch@1`
 * providers, selected via the `capabilities:` config section.
 */
export function webPack(): Registrable[] {
  return [
    browserSkill(),
    braveSkill(),
    firecrawlSkill(),
    webpageSkill(),
    sitemapSkill(),
    pageAuditSkill(),
  ];
}
