# Native hot core

The `hot-core/` Cargo workspace contains the Rust core, N-API boundary, and
WASM adapter. `bun run hot-core:build` places the platform-specific N-API addon
beside it as `elliott-hot-core.node`; the generated binary is intentionally not
committed.

The TypeScript scanner remains the automatic fallback when the addon is absent.
Production container builds compile and copy the Linux addon into this directory.
