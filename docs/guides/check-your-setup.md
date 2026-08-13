# How to check your setup end-to-end

`elliott doctor` is the out-of-box check for a fresh clone: it boots the bundled
framework skills, reports which ran and which stayed dormant, and runs one live
model round-trip against the provider you configured. Run it before wiring
anything else — it answers "is my LLM config right, and what else do I need to
set" in one command.

Contract and exit codes: [CLI reference](../reference/cli.md#elliott-doctor).

## Set the minimum config

The command needs only an LLM credential. The quickest path is a single vendor
key:

```bash
export ANTHROPIC_API_KEY=sk-ant-…    # or OPENAI_API_KEY=sk-…
bun src/cli.ts doctor                # or: bunx elliott doctor
```

A lone `ANTHROPIC_API_KEY` implies the `anthropic` provider and a default model;
`OPENAI_API_KEY` implies `openai`. To pin the model or point at an
OpenAI-compatible endpoint, set the explicit trio instead:

```bash
export ELLIOTT_LLM_PROVIDER=anthropic
export ELLIOTT_LLM_API_KEY=sk-ant-…
export ELLIOTT_LLM_MODEL=claude-haiku-4-5-20251001
bun src/cli.ts doctor
```

With no credential set, the command names what to set and exits non-zero.

## Read the report

```
LLM probe   OK  (anthropic wire, model claude-haiku-4-5-20251001, https://api.anthropic.com/v1)
  reply: "ready"

Ran (5):
  + deep-trace
  + fetch
  + files
  + glitchtip
  + scheduler

Skipped (18):
  - search-brave — needs key braveApiKey
  …

Vendor keys needed (8):
  - search-brave: set braveApiKey (secret://search/brave/api-key)
  …

Egress hosts contacted: api.anthropic.com
Elapsed: 0.3s

VERDICT: PASS
```

- **Ran** skills registered at least one tool, gateway, route, or service.
- **Skipped** skills loaded but stayed dormant. The reason is the manifest gate:
  a missing config flag, or a missing key. This is expected — a skill that needs
  a third-party vendor key is flagged by name and the boot continues.
- **Vendor keys needed** is the shopping list: each dormant, key-gated skill with
  the key it waits on and the `secret://` reference to supply. Set those in your
  agent repository's `config/secrets.yaml`, not here. See
  [Activation gates](../reference/activation-gates.md).

## What a failure looks like

A wrong key does not dump a stack trace — it prints the provider's own message
and exits non-zero:

```
LLM probe   FAILED  (anthropic wire, model claude-haiku-4-5-20251001, https://api.anthropic.com/v1)
  error: Anthropic 401: {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."}}
…
VERDICT: FAIL
```

The command talks to the LLM endpoint and nothing else. Any request to another
host is blocked, listed under the egress section, and fails the run — so a skill
that reaches off-box surfaces here rather than in production. A cold run that
takes longer than five minutes says so in its output.
