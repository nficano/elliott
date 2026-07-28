---
name: subscription-usage
description: Check Claude and Codex subscription rate-limit usage across accounts, and LiteLLM proxy spend.
---

# Subscription usage

Report how much of each AI coding subscription is used right now: the
five-hour session window and weekly windows for every configured Claude
(Pro/Max) and Codex (ChatGPT) account, plus spend totals from the local
LiteLLM proxy. Subscription usage comes from the same OAuth-authenticated
endpoints the vendors' own CLIs poll, so figures match what `/usage` in
Claude Code and `/status` in Codex show. Tokens are refreshed automatically
and rotated refresh tokens are persisted in runtime state; the Vault seed is
only read until the first rotation. These are unofficial endpoints — when a
provider changes them, report the failure rather than guessing at numbers.
