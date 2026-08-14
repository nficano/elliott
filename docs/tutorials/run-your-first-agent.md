# Run your first agent

In this tutorial we will clone elliott, point it at a model endpoint, boot it,
and read back the list of capabilities it loaded. At the end you will have a
running agent on `localhost:8080` and you will know how to tell which of its
skills woke up and which stayed dormant.

Budget about ten minutes. You need [Bun](https://bun.sh) 1.3.8, Git, and an API
key for any OpenAI-compatible endpoint.

## Step 1: Clone and install

```bash
git clone git@github.com:nficano/elliott.git
cd elliott
bun install
```

`bun install` does two jobs. It pulls dependencies, and its `prepare` lifecycle
installs the repository's git hooks. You want both.

Confirm the toolchain before going further:

```bash
bun run typecheck
```

That prints nothing and exits 0. Silence is the success case for `tsc --noEmit`.

## Step 2: Point it at a model

elliott ships no provider, no API key, and no model id. The config that ships
reads all three from the environment, so set them now:

```bash
export ELLIOTT_LLM_PROVIDER="anthropic"   # or: openai
export ELLIOTT_LLM_API_KEY="sk-ant-…"
export ELLIOTT_LLM_MODEL="claude-haiku-4-5-20251001"
```

Naming a provider resolves its endpoint and wire protocol for you: `anthropic`
talks to `https://api.anthropic.com/v1` on the native wire, `openai` to
`https://api.openai.com/v1` on `/chat/completions`. To point at anything else,
a LiteLLM proxy, Ollama, another vendor's `/v1`, set `llm.base_url` in
`config/elliott.yaml` instead (its line is commented out by default) and export
`ELLIOTT_LLM_BASE_URL`. Setting the env var without uncommenting that line does
nothing, because the shipped config never reads it.

Skip one of the three and the boot stops with the variable's name in the error,
which is the behavior you want the first time you deploy this somewhere real.

## Step 3: Boot

```bash
bun run start
```

The process serves until you interrupt it. Leave it running and open a second
shell for the rest of the tutorial.

## Step 4: Ask it what loaded

```bash
curl -s localhost:8080/healthz
```

You will see something close to this:

```json
{"ready":true,"release":"dev","skills":23,"tools":7,
 "gateways":{"deep-trace":"active"},
 "services":{"deep-trace":{"turns":0,"events":3,"clients":0,"dbTables":12},
             "glitchtip":{"queued":0,"sent":0,"dropped":0},"scheduler":{}}}
```

Notice the gap between the two numbers. All 23 bundled packages loaded, but
only 7 tools registered.

That gap is the single most important thing to understand about elliott. You can
see the full roster that loaded:

```bash
curl -s localhost:8080/v1/components
```

That returns one `{name, kind, protocols}` entry per package, all 23 of them. It
does not tell you which ones registered anything, which is exactly why the two
counts in `/healthz` matter.

Most of those packages read their manifest and then declined to register,
because each is waiting on a secret you have not supplied or a flag you have not
flipped. The `ssh` tool wants a host allowlist and a private key. The Slack
gateway wants four config values and a bot token. None of them failed. They are
dormant, and they register on the next boot once you give them what they ask
for.

A skill with nothing configured registers nothing rather than registering
something permissive. You will see that pattern everywhere.

## Step 5: Watch a dormant skill wake up

Let's activate one. Open `config/elliott.yaml` and find the `tools.terminal`
block. Set it to:

```yaml
tools:
  terminal:
    enabled: true
    root: .elliott-runtime/workspace
    allowed_commands: [ls, cat]
```

Stop the runtime with Ctrl-C, start it again, and re-check:

```bash
curl -s localhost:8080/healthz
```

The tool count went from 7 to 8. The terminal tool registered because it now
has both halves of what it needs: the flag *and* a non-empty allowlist. Set
`allowed_commands: []` and restart, and the count drops back to 7 even though
`enabled` is still `true`. An empty allowlist is not permission to run
anything. It is permission to run nothing.

## What you built

A running agent, one activated tool, and a working mental model:

- elliott boots one Bun process serving HTTP on port 8080.
- Every capability is a package that reads its own manifest and decides whether
  to register.
- Missing configuration produces absence of capability, never a default grant.
- `/healthz` and `/v1/components` are how you find out what actually happened.

## Next

Build a capability of your own in [Build your first skill](build-your-first-skill.md).

To understand why the loader behaves this way, read
[The security model](../explanation/security-model.md).
