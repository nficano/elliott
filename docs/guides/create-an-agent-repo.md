# How to create an agent repository

elliott is a framework. The thing you deploy is a separate repository that
installs it, holds your agent's persona and config, and boots the runtime
against its own root. This guide scaffolds one.

## Scaffold

```bash
bunx elliott new agent my-agent [parent-directory]
```

The command prints the directory it created. `[parent-directory]` defaults to
the working directory.

## Add elliott as a dependency

```bash
cd my-agent
bun add "elliott@git+ssh://git@github.com/nficano/elliott.git"
```

For reproducible deploys, pin to a commit:

```json
"dependencies": {
  "elliott": "git+ssh://git@github.com/nficano/elliott.git#<commit>"
}
```

## What the scaffold writes

```
my-agent/
├── main.ts                     # boots the installed elliott (frameworkRoot)
│                               # against this repo (agentRoot)
├── agents/<name>/
│   ├── agent.yaml              # persona, modelProfile, components, MCP endpoints
│   └── skills/                 # agent-specific skills, same package format
├── assets/prompts/<name>.md    # the persona
├── config/
│   ├── elliott.yaml            # required LLM fields as env-backed placeholders
│   └── secrets.yaml            # opaque ${ENV:…} / ${VAULT:…} references
└── package.json
```

The split matters at boot. `frameworkRoot` is the installed `elliott` package,
which is where the bundled `skills/` load from. `agentRoot` is this repository,
which supplies `config/elliott.yaml`, the agent definition, the persona, and
`agents/<name>/skills/`. Your repo owns `main.ts`, the Dockerfile, and the
deploy job.

## Boot it

```bash
export ELLIOTT_LLM_BASE_URL="https://api.example.com/v1"
export ELLIOTT_LLM_API_KEY="sk-…"
export ELLIOTT_LLM_MODEL="your-model-id"

bun run start
```

A missing required field fails the boot and names the field. Every key is in the
[configuration reference](../reference/configuration.md).

## Add a skill to it

Skills under `agents/<name>/skills/` load through the same two-pass loader as
the framework's own. Build them exactly as in
[Build your first skill](../tutorials/build-your-first-skill.md), with one
change: import framework types from the package exports rather than by relative
path.

```typescript
import type { SkillRegistration } from "elliott/skills";
import type { ToolDefinition } from "elliott/runtime";
```

Bun runs TypeScript straight out of `node_modules`, so there is no build step.

## If you need a skill that is generic

Put it in the [skills registry](install-registry-skills.md) instead, or in the
framework's `skills/` if every install should have it. Agent repositories are
for what only your agent needs. The reasoning is in
[Framework skills vs. agent skills](../explanation/framework-vs-agent-repos.md).

## Keep secrets out of the repository

`config/secrets.yaml` holds references, never values:

```yaml
ssh_private_key: ${ENV:ELLIOTT_SSH_PRIVATE_KEY}
brave_api_key: ${VAULT:secret/data/example#brave_api_key}
```

To keep secrets out of the container environment entirely, mount a JSON file
and point `ELLIOTT_SECRETS_FILE` at it. Set-but-unreadable fails the boot on
purpose, because a secretless boot would skip every skill that needs one and
still report itself healthy.
