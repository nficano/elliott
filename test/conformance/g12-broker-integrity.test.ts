import { describe, expect, it } from "bun:test";
import { digest, grantHandle } from "../../src/core/brands";
import { EpochRegistry } from "../../src/core/epoch/epochs";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { CapabilityBroker } from "../../src/security/broker/broker";
import type { BrokeredProviderToolCall } from "../../src/security/broker/types";
import { GrantManager } from "../../src/security/grants/manager";
import { OpaqueSecretStore } from "../../src/security/secrets/secrets";
import { makeGrantIssue, makeInvocation } from "../helpers";

describe("G12 broker integrity", () => {
  it("re-enters the broker for provider tool calls and rechecks authority", async () => {
    const records = new MemoryRecordAppender();
    const grants = new GrantManager(new EpochRegistry(records));
    const handle = grantHandle("grant:provider-tool");
    const issue = makeGrantIssue(handle);
    grants.issue(issue);
    const broker = new CapabilityBroker(
      grants,
      records,
      new OpaqueSecretStore(),
    );
    let executions = 0;
    const input: BrokeredProviderToolCall<string> = {
      provider: "provider",
      invocation: makeInvocation(),
      handle,
      capability: "network.connect",
      resource: "https://example.com/tool",
      frameClassification: "internal",
      destinationMaximumClassification: "internal",
      arguments: { query: "safe" },
      execute: async () => {
        executions += 1;
        return "tool-result";
      },
    };

    expect(await broker.executeProviderToolCall(input)).toBe("tool-result");
    expect(records.list().map((record) => record.type)).toEqual([
      "provider.tool-call-returned",
      "broker.dispatch",
      "broker.result",
    ]);

    await grants.update(handle, {
      sources: issue.sources.map((source) =>
        source.name === "session"
          ? { ...source, capabilities: [] }
          : source
      ),
      limitSources: issue.limitSources,
      policyDigests: [digest("policy:denied")],
      changedScope: "session",
      changedScopeId: "session",
    });
    await expect(broker.executeProviderToolCall(input)).rejects.toThrow(
      "Capability denied",
    );
    expect(executions).toBe(1);
  });
});
