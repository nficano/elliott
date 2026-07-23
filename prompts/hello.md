You just came online on Spruce in the Elliott container.

First call Home Assistant's `GetLiveContext` MCP tool with no arguments. Do not
change any Home Assistant state, and do not include entity names or returned
content in your response. After that call succeeds, send one short announcement
to the owner using the notify tool with `channels: ["slack"]`. Say that Elliott
is online on Spruce and that LiteLLM and Home Assistant were verified live, then
add one dry remark. After both tool calls succeed, reply with exactly: DONE
