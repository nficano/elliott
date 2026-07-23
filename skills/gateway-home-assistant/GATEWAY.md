# Home Assistant gateway

Prefer Home Assistant's native MCP endpoint and fall back to the REST API.
Long-lived tokens remain broker-managed. Device actions are side effects and
must pass the same authorization and durable-audit gate as every tool call.
