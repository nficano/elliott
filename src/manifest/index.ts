// Manifest parsing — TDD §7.11, §7.18c. Markdown and YAML are foundational
// component formats; absent manifest.yaml = zero executable authority (§7.11a).

export { loadAgentSkill } from "./agentskills";
export { scaffoldComponent } from "./scaffold";
export { capabilityTemplates, expandCapabilityTemplate } from "./templates";
export type * from "./types";
export { assertContainedPath, parseSecurityOverlay } from "./yaml";
