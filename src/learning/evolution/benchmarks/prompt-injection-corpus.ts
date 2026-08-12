import type { InjectionPattern } from "./types";

// Signatures that mark an evolution candidate's materialized artifact (a persona,
// prompt segment, tool description, or skill) as a prompt-injection or
// safety-bypass vector. A self-modifying agent must never *evolve away* its own
// injection resistance, and the evolution engine must not be steered into
// promoting an artifact that is itself an injection payload — so a match here
// fails the candidate and blocks promotion.
//
// Patterns run against lowercased content, are anchor-free (the payload can sit
// anywhere in the artifact), and are deliberately simple — flat alternations,
// no nested quantifiers — so matching stays linear-time.
export const PROMPT_INJECTION_PATTERNS: readonly InjectionPattern[] = [
  {
    id: "ignore-previous-instructions",
    matcher:
      /ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts|rules)/,
  },
  {
    id: "disregard-safety",
    matcher:
      /(disregard|override|forget|bypass) (the )?(system|safety|security) (prompt|rules|instructions|guardrails)/,
  },
  {
    id: "reveal-system-prompt",
    matcher:
      /(reveal|print|show|output|repeat|disclose) (me )?(your |the )?(system prompt|initial instructions|hidden instructions)/,
  },
  {
    id: "exfiltrate-secrets",
    matcher:
      /(reveal|print|leak|exfiltrate|send|forward|email) (me )?(the |your )?(secrets?|credentials?|tokens?|api keys?|passwords?|private keys?)/,
  },
  {
    id: "trust-untrusted-content",
    matcher:
      /treat (tool|user|external|retrieved|web|email) (output|input|content|data|results?) as (instructions|commands|authoritative|trusted)/,
  },
  {
    id: "developer-jailbreak",
    matcher:
      /(developer mode|jailbreak|dan mode|do anything now|unfiltered mode)/,
  },
  {
    id: "dump-environment",
    matcher:
      /(print|dump|output|leak) (the )?(environment variables?|env vars?|process\.env|\.env file)/,
  },
];
