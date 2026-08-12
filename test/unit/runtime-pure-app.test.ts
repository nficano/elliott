import { describe, expect, it } from "bun:test";
import {
  resolveRuntimeRoute,
  selectPrimaryGateway,
  selectReplyGateway,
} from "../../src/runtime/app";
import type {
  GatewayBinding,
  RouteBinding,
} from "../../src/runtime/skills/types";

const route = (method: string, path: string): RouteBinding => ({
  method,
  path,
  handle: async () => new Response("ok"),
});

const makeGateway = (
  name: string,
  opts: { canSend?: boolean; defaultChannel?: string; } = {},
): GatewayBinding => ({
  name,
  status: () => "ok",
  start: async () => {},
  stop: () => {},
  ...(opts.canSend === true && { send: async () => {} }),
  ...(opts.defaultChannel !== undefined
    && { defaultChannel: opts.defaultChannel }),
});

const noPlanes = {
  hasEvolutionControlPlane: false,
  hasGovernanceControlPlane: false,
  routes: [] as readonly RouteBinding[],
};

describe("resolveRuntimeRoute", () => {
  it("resolves /healthz to health regardless of method", () => {
    expect(resolveRuntimeRoute("GET", "/healthz", noPlanes)).toEqual({
      kind: "health",
    });
    expect(resolveRuntimeRoute("POST", "/healthz", noPlanes)).toEqual({
      kind: "health",
    });
  });

  it("resolves /v1/components to components", () => {
    expect(resolveRuntimeRoute("GET", "/v1/components", noPlanes)).toEqual({
      kind: "components",
    });
  });

  it("health takes precedence over a route registered at the same path", () => {
    const routes = [route("GET", "/healthz")];
    expect(
      resolveRuntimeRoute("GET", "/healthz", { ...noPlanes, routes }),
    ).toEqual({ kind: "health" });
  });

  it("resolves the evolution control path only when its flag is set", () => {
    expect(
      resolveRuntimeRoute("POST", "/v1/control/evolution", {
        ...noPlanes,
        hasEvolutionControlPlane: true,
      }),
    ).toEqual({ kind: "evolution-control" });
  });

  it("resolves the governance control path only when its flag is set", () => {
    expect(
      resolveRuntimeRoute("POST", "/v1/control/governance", {
        ...noPlanes,
        hasGovernanceControlPlane: true,
      }),
    ).toEqual({ kind: "governance-control" });
  });

  it("falls through control path to a matching route when the flag is off", () => {
    const routes = [route("POST", "/v1/control/evolution")];
    expect(
      resolveRuntimeRoute("POST", "/v1/control/evolution", {
        hasEvolutionControlPlane: false,
        hasGovernanceControlPlane: false,
        routes,
      }),
    ).toEqual({ kind: "route", index: 0 });
  });

  it("falls through control path to not-found when the flag is off and no route matches", () => {
    expect(
      resolveRuntimeRoute("POST", "/v1/control/governance", noPlanes),
    ).toEqual({ kind: "not-found" });
  });

  it("matches a dynamic route by method and path, returning its index", () => {
    const routes = [
      route("GET", "/a"),
      route("POST", "/b"),
      route("GET", "/c"),
    ];
    expect(
      resolveRuntimeRoute("POST", "/b", { ...noPlanes, routes }),
    ).toEqual({ kind: "route", index: 1 });
  });

  it("does not match a route when the method differs", () => {
    const routes = [route("GET", "/a")];
    expect(
      resolveRuntimeRoute("POST", "/a", { ...noPlanes, routes }),
    ).toEqual({ kind: "not-found" });
  });

  it("returns not-found for an unknown path", () => {
    expect(resolveRuntimeRoute("GET", "/nope", noPlanes)).toEqual({
      kind: "not-found",
    });
  });
});

describe("selectPrimaryGateway", () => {
  it("returns undefined with no gateways", () => {
    expect(selectPrimaryGateway([])).toBeUndefined();
  });

  it("prefers a gateway that can send and has a default channel", () => {
    const sendOnly = makeGateway("send-only", { canSend: true });
    const full = makeGateway("full", { canSend: true, defaultChannel: "#c" });
    expect(selectPrimaryGateway([sendOnly, full])).toBe(full);
  });

  it("falls back to any gateway that can send when none has a default channel", () => {
    const noSend = makeGateway("no-send", { defaultChannel: "#c" });
    const sendOnly = makeGateway("send-only", { canSend: true });
    expect(selectPrimaryGateway([noSend, sendOnly])).toBe(sendOnly);
  });

  it("returns undefined when no gateway can send", () => {
    const noSend = makeGateway("no-send", { defaultChannel: "#c" });
    expect(selectPrimaryGateway([noSend])).toBeUndefined();
  });
});

describe("selectReplyGateway", () => {
  it("returns the origin gateway when it can send", () => {
    const origin = makeGateway("origin", { canSend: true });
    const other = makeGateway("other", { canSend: true, defaultChannel: "#c" });
    expect(selectReplyGateway([other, origin], "origin")).toBe(origin);
  });

  it("falls back to the primary when the origin cannot send", () => {
    const origin = makeGateway("origin");
    const primary = makeGateway("primary", {
      canSend: true,
      defaultChannel: "#c",
    });
    expect(selectReplyGateway([origin, primary], "origin")).toBe(primary);
  });

  it("falls back to the primary when the origin name is unknown", () => {
    const primary = makeGateway("primary", { canSend: true });
    expect(selectReplyGateway([primary], "missing")).toBe(primary);
  });

  it("returns undefined with no gateways", () => {
    expect(selectReplyGateway([], "origin")).toBeUndefined();
  });
});
