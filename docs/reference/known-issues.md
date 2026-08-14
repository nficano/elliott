# Known issues

Limits the framework knows about and has decided not to close yet. Each entry
says what the limit is, why it is acceptable today, and what closing it takes.
An entry here is a deliberate position, not a bug someone forgot.

## Secret-field rejection is inference, not declaration

`assertConfigSecretReferences` decides which config fields hold a credential
from the field's key: its final word against a role set (`token`, `secret`,
`password`, `passphrase`, `dsn`, `key`, `credential`) in either `snake_case` or
`camelCase`, plus a declared set of credential fields whose names carry no role
word (`authorization`, `cookie`, `session`, `access_url`, `webhook_url`).

A skill may name its credential field something else — `auth`, `bearer`, or
anything bespoke — under the `skills.*` passthrough. A literal credential there
is not rejected at load.

**Why this is acceptable.** Rejection is early failure, not containment. Nothing
operator-facing depends on it being complete: the doctor forwards no untrusted
text at all (a skill's `register()` error, an agent-local manifest's name, gate,
or secret references, an endpoint's response body), and prints only facts it
derived. A credential the role test misses therefore has no channel to reach a
terminal or a log. G27 states this scope explicitly rather than claiming an
invariant it does not hold.

**What closing it takes.** Skill manifests declaring their own secret config
fields, which means the loader must read manifests before the config boundary
resolves config — today config loads first, so the boundary has no manifest to
consult. That is a change to the skill contract and the loader's ordering, not a
patch to the predicate. Adding more words to the role set is not a fix; it moves
the same gap to the next unlisted name.

## The doctor reports that a skill failed, not why

`elliott doctor` prints a skill's registration failure as a derived phrase
(`register() failed during startup`) and non-fatal reports as a count. The
exception text is never captured. The model client likewise never reads a non-2xx
response body: the report carries the wire name and status code only.

**Why this is acceptable.** Both are untrusted text. A skill's error can echo any
of that skill's own config, and an endpoint — the one party given the api key —
can echo the key back, whole, sliced, or re-encoded. No value-matching scrub over
attacker-chosen bytes is safe, so the text is not forwarded at all.

**Cost, and what closing it takes.** An operator whose skill fails to register
learns which skill failed but not why, which is a real loss for a command whose
purpose is out-of-box diagnosis. The close is an opt-in that writes the raw text
to a file under `stateDirectory` and prints only the path: nothing untrusted
reaches a terminal or a shipped container log, and the operator can still read it
deliberately.
