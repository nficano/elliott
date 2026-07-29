import { describe, expect, it } from "bun:test";
import { mergeTopology } from "../../../skills/telemetry-map/src/auto-topology";
import type {
  SkillPackageView,
  StoredGrant,
} from "../../../src/runtime/skills/types";

const BASE_DOCUMENT = {
  version: "test",
  domains: [
    { id: "ingress", title: "Ingress" },
    { id: "tool-execution", title: "Tool execution" },
  ],
  nodes: [
    { id: "runtime.http", kind: "runtime", domain: "ingress", runtime: "live" },
    {
      id: "runtime.inbound",
      kind: "runtime",
      domain: "ingress",
      runtime: "live",
    },
    {
      id: "runtime.toolExec",
      kind: "runtime",
      domain: "tool-execution",
      runtime: "live",
    },
    {
      id: "gateway.webhook",
      kind: "gateway",
      domain: "ingress",
      runtime: "config-gated",
    },
  ],
  edges: [
    {
      id: "e.base.http-inbound",
      from: "runtime.http",
      to: "runtime.inbound",
      kind: "data",
    },
  ],
};

const base = (): string => JSON.stringify(BASE_DOCUMENT, undefined, 2);

const view = (
  overrides: Partial<SkillPackageView> & { readonly name: string; },
): SkillPackageView => ({
  kind: "tool",
  directory: `/srv/elliott/skills/${overrides.name}`,
  provides: [],
  registered: true,
  bindings: { tools: 1, gateways: 0, routes: 0, services: 0, facilities: 0 },
  ...overrides,
});

const merge = (
  packages: readonly SkillPackageView[],
  grants: readonly StoredGrant[] = [],
): {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  domains: { id: string; title?: string; }[];
  autoRegistration?: {
    nodes: string[];
    edges: string[];
    liveness: Record<string, string>;
  };
} =>
  JSON.parse(mergeTopology({ base: base(), packages, grants })) as ReturnType<
    typeof merge
  >;

describe("mergeTopology", () => {
  it("returns the base string verbatim when nothing changes", () => {
    const body = base();
    expect(mergeTopology({ base: body, packages: [], grants: [] })).toBe(body);
  });

  it("returns an unparseable base untouched", () => {
    expect(mergeTopology({ base: "not json", packages: [], grants: [] }))
      .toBe("not json");
  });

  it("adds a node with uniform tool edges for a dispatch:tool skill", () => {
    const merged = merge([view({
      name: "widget",
      topology: {
        node: { id: "tool.widget", kind: "tool", domain: "tool-execution" },
        dispatch: "tool",
      },
    })]);
    expect(merged.nodes.map((node) => node["id"])).toContain("tool.widget");
    expect(merged.edges).toContainEqual(expect.objectContaining({
      from: "runtime.toolExec",
      to: "tool.widget",
      kind: "data",
    }));
    expect(merged.autoRegistration?.nodes).toEqual(["tool.widget"]);
  });

  it("substitutes self in declared edges and drops dangling ones", () => {
    const merged = merge([view({
      name: "widget",
      topology: {
        node: { id: "tool.widget", kind: "tool", domain: "tool-execution" },
        dispatch: "none",
        edges: [
          {
            from: "self",
            to: "runtime.inbound",
            kind: "data",
            label: "payload",
          },
          { from: "self", to: "node.that.does.not.exist", kind: "data" },
        ],
      },
    })]);
    expect(merged.edges).toContainEqual(expect.objectContaining({
      from: "tool.widget",
      to: "runtime.inbound",
      kind: "data",
      label: "payload",
    }));
    expect(merged.edges.map((edge) => edge["to"]))
      .not.toContain("node.that.does.not.exist");
  });

  it("does not duplicate an edge the base already declares", () => {
    const merged = merge([view({
      name: "widget",
      topology: {
        node: { id: "tool.widget", kind: "tool", domain: "tool-execution" },
        dispatch: "none",
        edges: [{ from: "runtime.http", to: "runtime.inbound", kind: "data" }],
      },
    })]);
    const matches = merged.edges.filter((edge) =>
      edge["from"] === "runtime.http" && edge["to"] === "runtime.inbound"
      && edge["kind"] === "data"
    );
    expect(matches.length).toBe(1);
  });

  it("appends a minimal domain entry for an unknown domain", () => {
    const merged = merge([view({
      name: "widget",
      topology: {
        node: { id: "tool.widget", kind: "tool", domain: "local-network" },
        dispatch: "tool",
      },
    })]);
    expect(merged.domains).toContainEqual({
      id: "local-network",
      title: "Local-network",
    });
  });

  it("marks a registration that produced no bindings as config-gated", () => {
    const merged = merge([view({
      name: "widget",
      bindings: {
        tools: 0,
        gateways: 0,
        routes: 0,
        services: 0,
        facilities: 0,
      },
      topology: {
        node: { id: "tool.widget", kind: "tool", domain: "tool-execution" },
        dispatch: "tool",
      },
    })]);
    const node = merged.nodes.find((item) => item["id"] === "tool.widget");
    expect(node?.["runtime"]).toBe("config-gated");
  });

  it("lets one live registration win when two skills share a node", () => {
    const topology = {
      node: { id: "tool.search", kind: "tool", domain: "tool-execution" },
      dispatch: "tool",
    };
    const gated = view({
      name: "search-a",
      topology,
      bindings: {
        tools: 0,
        gateways: 0,
        routes: 0,
        services: 0,
        facilities: 0,
      },
    });
    const live = view({ name: "search-b", topology });
    for (const order of [[gated, live], [live, gated]]) {
      const node = merge(order).nodes.find((item) =>
        item["id"] === "tool.search"
      );
      expect(node?.["runtime"]).toBe("live");
    }
  });

  it("overrides liveness on a base node without duplicating it", () => {
    const merged = merge([view({
      name: "gateway-webhook",
      kind: "gateway",
      topology: {
        node: { id: "gateway.webhook", kind: "gateway", domain: "ingress" },
        dispatch: "route",
      },
      bindings: {
        tools: 0,
        gateways: 0,
        routes: 1,
        services: 0,
        facilities: 0,
      },
    })]);
    const matches = merged.nodes.filter((item) =>
      item["id"] === "gateway.webhook"
    );
    expect(matches.length).toBe(1);
    expect(matches[0]?.["runtime"]).toBe("live");
    expect(merged.autoRegistration?.liveness).toEqual({
      "gateway.webhook": "live",
    });
  });

  it("keeps the source repo-relative for agent skills", () => {
    const merged = merge([view({
      name: "openbanking",
      directory: "/srv/tide-pods/agents/oslo/skills/openbanking",
      topology: {
        node: { id: "tool.openbanking", kind: "tool", domain: "finance" },
        dispatch: "tool",
      },
    })]);
    const node = merged.nodes.find((item) => item["id"] === "tool.openbanking");
    expect(node?.["source"]).toBe("agents/oslo/skills/openbanking");
  });

  it("derives consumer->provider edges from facility grants", () => {
    const provider = view({
      name: "traefik",
      provides: ["core/proxy.route"],
      topology: {
        node: { id: "tool.traefik", kind: "tool", domain: "local-network" },
        dispatch: "tool",
      },
    });
    const consumer = view({
      name: "widget",
      topology: {
        node: { id: "tool.widget", kind: "tool", domain: "tool-execution" },
        dispatch: "tool",
      },
    });
    const grant: StoredGrant = {
      consumer: "widget",
      name: "public",
      facilityId: "core/proxy.route",
      version: 1,
      config: {},
      grant: { grantId: "g-1", facility: "core/proxy.route", values: {} },
    };
    const merged = merge([provider, consumer], [grant]);
    expect(merged.edges).toContainEqual(expect.objectContaining({
      from: "tool.widget",
      to: "tool.traefik",
      kind: "control",
      label: "facility core/proxy.route (public)",
    }));
  });
});
