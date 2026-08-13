# How to check your setup end-to-end

`elliott doctor` is the out-of-box check for a fresh clone: it boots the skills,
reports which ran and which stayed dormant, and runs one live model round-trip
against the provider you configured. Run it before wiring anything else — it
answers "is my LLM config right, and what else do I need to set" in one command.

It checks the deployment in your current working directory. Inside this repo that
is the repo itself; from a consumer repo that boots elliott as a package (`bunx
elliott doctor`), it reads that repo's config, agent definition, secrets, and
agent-local skills, while the bundled framework skills come from the package. Set
`ELLIOTT_AGENT_NAME` if your agent is not named `elliott`.

Contract and exit codes: [CLI reference](../reference/cli.md#elliott-doctor).

## Set the minimum config

The command needs only an LLM credential. The quickest path is a single vendor
key:

```bash
export ANTHROPIC_API_KEY=sk-ant-…    # or OPENAI_API_KEY=sk-…
bun src/cli.ts doctor                # or: bunx elliott doctor
```

A lone `ANTHROPIC_API_KEY` implies the `anthropic` provider and a default model;
`OPENAI_API_KEY` implies `openai`. To pin the model, set the explicit trio
instead:

```bash
export ELLIOTT_LLM_PROVIDER=anthropic
export ELLIOTT_LLM_API_KEY=sk-ant-…
export ELLIOTT_LLM_MODEL=claude-haiku-4-5-20251001
bun src/cli.ts doctor
```

To run against an OpenAI-compatible endpoint, set `llm.base_url` in
`config/elliott.yaml` (its line is commented by default, and the shipped config
reads a provider) and export `ELLIOTT_LLM_BASE_URL`; the doctor loads whatever
that config requires. Exporting `ELLIOTT_LLM_BASE_URL` without editing the
config does nothing, because the shipped config never reads it.

With no credential set, the command names the exact variable the loaded config
is missing and exits non-zero.

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
  - search-brave — dormant (gate secret:braveApiKey)
  …

Vendor keys needed (8) — see docs/reference/activation-gates.md for the full requirement of each:
  - search-brave: supply secret://search/brave/api-key  (gate secret:braveApiKey)
  …

Egress hosts contacted: api.anthropic.com
Elapsed: 0.3s

VERDICT: PASS
```

- **Ran** skills registered at least one tool, gateway, route, or service.
- **Skipped** skills loaded but stayed dormant. The reason is the manifest gate:
  a config flag or a secret. This is expected — a skill needing a third-party
  vendor key is flagged by name and the boot continues. (A bundled package that
  produces no registration at all is reported as an error, not a skip.)
- **Vendor keys needed** is the shopping list: each dormant, secret-gated skill
  with the `secret://` reference to supply and its manifest gate. Some skills
  need more than that one secret — a composite gate such as SMTP also wants
  host, sender, and recipients — so the section points at
  [Activation gates](../reference/activation-gates.md) for the full requirement.
  Set these in your agent repository's `config/secrets.yaml`, not here.

## What a failure looks like

A wrong key does not dump a stack trace — it prints the provider's own message
and exits non-zero:

```
LLM probe   FAILED  (anthropic wire, model claude-haiku-4-5-20251001, https://api.anthropic.com/v1)
  error: Anthropic 401: {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."}}
…
VERDICT: FAIL
```

The message is scrubbed of the API key and flattened to a single line, so a
hostile or misconfigured endpoint cannot echo your key or forge a verdict line
into the output.

The command talks to the LLM endpoint and nothing else. It follows redirects
manually and checks every hop, so an allowlisted endpoint cannot bounce a
request to a third host: any host outside the allowlist — including a redirect
target — is blocked, listed under the egress section, and fails the run. A skill
that reaches off-box surfaces here rather than in production. A cold run that
takes longer than five minutes says so in its output.
