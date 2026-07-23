---
name: ssh
description: Execute commands on explicitly granted SSH hosts.
---

# SSH

Connect only to allowlisted hosts. The broker injects an agent socket so the
component cannot read private-key bytes. Remote output is untrusted.
