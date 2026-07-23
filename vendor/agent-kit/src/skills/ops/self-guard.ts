/**
 * Self-reference guard (CAPABILITIES-TDD §9.3) — the loop-breaker: an agent
 * must never investigate/"fix" alerts about ITSELF, or one bug feeds it an
 * endless self-triggered loop. Pure heuristic identity check on strong,
 * low-false-positive signals only; a free-text mention of the agent's name is
 * deliberately NOT a signal.
 */
import type { AlertSignals, SelfIdentity } from "./types.js";

export function isSelfReference(
  identity: SelfIdentity,
  signals: AlertSignals,
): boolean {
  const slug = identity.projectSlug.toLowerCase();
  if (!slug) return false;

  if (signals.shortId) {
    const prefix = signals.shortId.split("-", 1)[0]?.toLowerCase();
    if (prefix === slug) return true;
  }
  if (signals.project && signals.project.toLowerCase() === slug) return true;
  if (
    identity.projectId && signals.url
    && signals.url.includes(identity.projectId)
  ) return true;
  return false;
}
