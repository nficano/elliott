# Security policy

Elliott is a security-first framework: its purpose is running untrusted
content through powerful tools safely. Security reports are taken
seriously and handled with priority.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.**

Report privately via
[GitHub security advisories](https://github.com/nficano/elliott/security/advisories/new)
or by email to <nficano@gmail.com> with `[elliott security]` in the
subject.

Please include:

- the affected component or path (e.g. `src/security/broker`, a bundled
  skill, the runtime loop);
- a reproduction or proof of concept;
- your assessment of impact — especially anything that lets model
  inference bypass the capability broker, gives tool output instruction
  precedence, widens a grant, escapes a sandbox/allowlist, or exfiltrates
  a secret.

You can expect an acknowledgment within a few days. Please allow a fix
to land before public disclosure; credit is given unless you prefer
otherwise.

## Scope notes

- Prompt-injection resistance is in scope: external content gaining
  instruction precedence over the loop's `[UNTRUSTED …]` framing is a
  vulnerability, not a model quirk.
- Findings in the intentionally stubbed parts of the canonical
  orchestrator are welcome but will be triaged as design feedback rather
  than exploitable issues.

## Supported versions

There are no versioned releases yet; fixes land on `main`. Consumers
pinning Elliott as a git dependency should track `main` or a recent
commit.
