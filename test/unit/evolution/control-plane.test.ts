import { describe, expect, it } from "bun:test";
import {
  makeEvolutionControlPlane,
} from "../../../src/learning/evolution/cli/control-plane";

const request = (body: unknown, method = "POST"): Request =>
  new Request("https://elliott.test/v1/control/evolution", {
    method,
    ...(method === "POST" && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });

describe("evolution operator control plane", () => {
  it("resolves current authority and binds the active Snapshot", async () => {
    let capability = "";
    const controlPlane = makeEvolutionControlPlane({
      resolve: async () => ({
        principalId: "operator",
        snapshotId: "snapshot:current",
        authorize: async (requested) => {
          capability = requested;
          return true;
        },
      }),
    }, {
      execute: async (_authority, operation) => ({
        operation: operation.operation,
      }),
    });
    const response = await controlPlane.handle(request({
      operation: "release.promote",
      arguments: ["proposal"],
    }));
    expect(response.status).toBe(200);
    expect(capability).toBe("release.promote");
    expect(await response.json()).toEqual({
      principalId: "operator",
      snapshotId: "snapshot:current",
      result: { operation: "release.promote" },
    });
  });

  it("rejects missing authority and malformed operations", async () => {
    let executions = 0;
    const controlPlane = makeEvolutionControlPlane({
      resolve: async () => ({
        principalId: "operator",
        snapshotId: "snapshot:current",
        authorize: async () => false,
      }),
    }, {
      execute: async () => {
        executions += 1;
        return {};
      },
    });
    const denied = await controlPlane.handle(request({
      operation: "proposal.approve",
      arguments: ["proposal"],
    }));
    expect(denied.status).toBe(401);
    expect(executions).toBe(0);
    expect(
      (await controlPlane.handle(request({
        operation: "release.deploy",
        arguments: ["proposal"],
      }))).status,
    ).toBe(400);
    expect((await controlPlane.handle(request({}, "GET"))).status).toBe(405);
  });
});
