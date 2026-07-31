import { describe, expect, it } from "bun:test";
import { BUNDLED_CATALOG } from "../../src/catalog/index";
import { componentRef, principalId } from "../../src/core/brands";
import { hashValue } from "../../src/core/digest";
import { McpEndpoint } from "../../src/mcp/endpoint/index";
import { ModernMcpDriver } from "../../src/mcp/modern-driver/index";
import type { McpArtifact } from "../../src/mcp/types";
import { egressClass, resolveEgress } from "../../src/placement/egress";

describe("data plane", () => {
  it("min-composes egress and never ships any as a bundled default", () => {
    const effective = resolveEgress({
      manifest: egressClass("declared", ["a.example", "b.example"]),
      template: egressClass("declared", ["b.example"]),
      workspace: egressClass("any"),
      organization: egressClass("declared", ["b.example", "c.example"]),
    });
    expect(effective).toEqual(egressClass("declared", ["b.example"]));
    expect(BUNDLED_CATALOG.some((item) => item.egress.kind === "any")).toBe(
      false,
    );
    expect(
      BUNDLED_CATALOG.find((item) => item.name === "fetch")
        ?.secretRefs,
    ).toEqual([]);
    expect(
      BUNDLED_CATALOG.find((item) => item.name === "ssh")
        ?.isolation,
    ).toBe("container");
  });

  it("pins MCP virtual children to an approved catalog snapshot", async () => {
    let artifacts: McpArtifact[] = [{
      name: "search",
      kind: "tool",
      description: "Search",
      inputSchema: { type: "object" },
    }];
    const transport = {
      async discover() {
        return { artifacts, capabilities: [] };
      },
      async invoke() {
        return { content: "external result" };
      },
    };
    const approvedCatalogDigest = hashValue(artifacts);
    const endpoint = new McpEndpoint({
      ref: componentRef("workspace/mcp-endpoint/github"),
      principal: principalId("mcp:github"),
      classification: "internal",
      approvedCatalogDigest,
      allowSampling: false,
      allowElicitation: false,
      allowRoots: false,
    }, new ModernMcpDriver(transport));
    const active = await endpoint.connect();
    expect(active.state).toBe("healthy");
    expect(active.children.at(0)?.ref).toBe("mcp.github.tool.search");
    const result = await endpoint.invoke({ artifact: "search", input: {} });
    expect(result.content).toMatchObject({
      contentTrust: "untrusted",
      classification: "internal",
      payload: "external result",
    });
    await expect(endpoint.invoke({
      artifact: "search",
      input: { accessToken: "forbidden" },
    })).rejects.toThrow("passthrough");
    artifacts = [...artifacts, {
      name: "create-issue",
      kind: "tool",
      description: "Create issue",
      inputSchema: { type: "object" },
    }];
    const drifted = await endpoint.connect();
    expect(drifted.state).toBe("requires-approval");
    expect(endpoint.active?.catalogDigest).toBe(approvedCatalogDigest);
  });
});
