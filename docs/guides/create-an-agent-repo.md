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

```
my-agent/
├── agents/<name>/
│   ├── ...              # agent definition (model routes, MCP endpoints)
│   └── skills/          # agent-specific skills — same package format
│                        # as the framework's skills/ directory
├── config/
│   ├── elliott.yaml     # runtime configuration
│   └── secrets.yaml     # opaque ${VAULT:...} references only
└── package.json
```

Skills under `agents/<name>/skills/` are loaded by the same two-pass
loader as framework-bundled skills; build them exactly as in
[the first-skill tutorial](../tutorials/your-first-skill.md).

## Boot

Run the runtime entry point from the installed package, pointing it at
your repository as the agent root:

```bash
bun node_modules/elliott/src/runtime/main.ts
```

Configuration keys are documented in
[reference/configuration.md](../reference/configuration.md). Secrets stay
opaque references; never commit a literal secret to the agent repository.
