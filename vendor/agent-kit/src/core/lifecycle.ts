/**
 * Supervised-subsystem contract (§3). Each subsystem resolved from the container
 * implements `{ start(); stop(); health() }`; the process supervisor starts them
 * in dependency order and stops them in reverse, with a graceful drain (§20).
 */
import type { Health, HealthState } from "./types.js";

export const HEALTHY: Health = { state: "ok" };

/** Combine child healths — the worst state wins. */
export function worstHealth(healths: Health[]): Health {
  let state: HealthState = "ok";
  const details: string[] = [];
  for (const h of healths) {
    if (h.state === "down") state = "down";
    else if (h.state === "degraded" && state !== "down") state = "degraded";
    if (h.detail) details.push(h.detail);
  }
  return details.length > 0 ? { state, detail: details.join("; ") } : { state };
}
