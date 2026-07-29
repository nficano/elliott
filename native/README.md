# Native hot core

`bun run hot-core:build` places the platform-specific N-API addon here as
`elliott-hot-core.node`. The generated binary is intentionally not committed.

The TypeScript scanner remains the automatic fallback when the addon is absent.
Production container builds compile and copy the Linux addon into this directory.
