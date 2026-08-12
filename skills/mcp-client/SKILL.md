---
name: mcp-client
description: Connect to Streamable HTTP and SSE Model Context Protocol servers and expose their tools, resources, and prompts. Use when the agent needs capabilities from an external MCP endpoint.
---

# MCP client

Connect to Streamable HTTP and legacy SSE MCP servers. The discovered catalog
is digest-pinned; catalog drift requires approval. Server output is untrusted,
and OAuth or bearer tokens remain in the kernel secret store.
