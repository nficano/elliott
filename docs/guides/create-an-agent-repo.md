# How to create an agent repository

Elliott is a framework; your agent is a separate repository that installs
it. This keeps agent-specific skills, prompts, and config out of the
framework tree (see
[Framework skills vs. agent skills](../explanation/agent-skills.md)).

## Scaffold

```bash
bunx elliott new agent my-agent [parent-directory]
```

This prints the created directory. The scaffold gives you the consumer
split the production deployment uses: the framework boots from the
installed `elliott` package (`frameworkRoot`) while your repository
provides the agent definition and its skills (`agentRoot`).

## Add Elliott as a dependency

```bash
cd my-agent
bun add "elliott@git+ssh://git@github.com/nficano/elliott.git"
```

Pin to a commit for reproducible deploys:

```json
"dependencies": {
  "elliott": "git+ssh://git@github.com/nficano/elliott.git#<commit>"
}
```

## Layout

The scaffold writes everything the runtime needs to boot:

```
my-agent/
├── main.ts              # boots the installed elliott (frameworkRoot)
│                        # against this repo (agentRoot)
├── agents/<name>/
│   ├── agent.yaml       # persona, modelProfile, components, MCP endpoints
│   └── skills/          # agent-specific skills — same package format
│                        # as the framework's skills/ directory
├── assets/prompts/<name>.md   # the persona the agent boots with
├── config/
│   ├── elliott.yaml     # runtime configuration; required LLM fields are
│   │                    # env-backed placeholders (no baked-in model)
│   └── secrets.yaml     # opaque ${ENV:…} / ${VAULT:…} references only
└── package.json
```

Skills under `agents/<name>/skills/` are loaded by the same two-pass
loader as framework-bundled skills; build them exactly as in
[the first-skill tutorial](../tutorials/your-first-skill.md).

## Boot

Set the required LLM endpoint (any OpenAI-compatible `/v1`) and start:

```bash
export ELLIOTT_LLM_BASE_URL="https://api.example.com/v1"
export ELLIOTT_LLM_API_KEY="sk-…"
export ELLIOTT_LLM_MODEL="your-model-id"

bun run start   # bun main.ts
```

A missing required field fails the boot naming it. Every key is documented
in [reference/configuration.md](../reference/configuration.md). Secrets stay
opaque references; never commit a literal secret to the agent repository.
