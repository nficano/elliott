// The framework surface for skill authors and agent repos ("elliott/skills"):
// the package contract types, the registration loader, and the JSON/schema
// helpers every bundled skill uses. See docs/explanation/agent-skills.md.
export { isJsonRecord, nestedRecord, recordArray } from "../../providers/http";
export * from "./facilities";
export * from "./http";
export * from "./loader";
export * from "./schema";
export type * from "./types";
