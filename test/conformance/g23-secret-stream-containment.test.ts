import { describe, expect, it } from "bun:test";
import {
  digest,
  grantHandle,
  placementRef,
  principalId,
  scopeId,
} from "../../src/core/brands";
import { EpochRegistry } from "../../src/core/epoch/epochs";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { LinearDfaScanner } from "../../src/hotcore/index";
import { CompanionManager } from "../../src/placement/companions/index";
import { egressClass } from "../../src/placement/egress";
import type { SecurityContext } from "../../src/placement/types";
import { CapabilityBroker } from "../../src/security/broker/broker";
import { GrantManager } from "../../src/security/grants/manager";
import { OpaqueSecretStore } from "../../src/security/secrets/secrets";
import { makeGrantIssue, makeInvocation } from "../helpers";

describe("G23 secret and streamed-argument containment", () => {
  it("binds companion reachability, egress, context, and lifecycle to its owner", async () => {
    const manager = new CompanionManager({
      async probe() {
        return false;
      },
    });
    const owner = placementRef("owner");
    const other = placementRef("other");
    const context: SecurityContext = {
      effectiveCeilingDigest: digest("ceiling"),
      maximumClassification: "confidential",
      trustDomain: "workspace",
      scope: { level: "workspace", id: scopeId("workspace") },
      securityCritical: false,
    };
    const companion = await manager.open({
      owner,
      context,
      ownerEgress: egressClass("declared", ["database.local"]),
      declaration: {
        name: "database",
        image: "example/database@sha256:1234",
        egress: egressClass("none"),
        endpoint: "database",
        tmpfs: [],
        secretRefs: [],
        manifestDigest: digest("manifest-with-image"),
      },
    });
    expect(companion.securityContext).toBe(context);
    expect(companion.effectiveEgress.kind).toBe("none");
    expect(manager.canReach(companion.id, owner)).toBe(true);
    expect(manager.canReach(companion.id, other)).toBe(false);
    expect(manager.drainOwner(owner)[0]?.state).toBe("closed");
  });

  it("carries scanner state across chunks and blocks before dispatch", async () => {
    const records = new MemoryRecordAppender();
    const grants = new GrantManager(new EpochRegistry(records));
    const handle = grantHandle("grant:stream");
    grants.issue(makeGrantIssue(handle));
    const secret = "super-secret-value";
    const secrets = new OpaqueSecretStore();
    secrets.register({
      uri: "secret://provider/token",
      value: secret,
      policy: {
        principal: principalId("principal"),
        destination: "https://example.com",
        operation: "request",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        rotation: "daily",
        injection: "broker-request",
      },
    });
    const broker = new CapabilityBroker(grants, records, secrets);
    let prepared = 0;
    let committed = 0;
    let discarded = 0;
    const stream = broker.beginStream({
      invocation: makeInvocation(),
      handle,
      capability: "network.connect",
      resource: "https://example.com/api",
      frameClassification: "internal",
      destinationMaximumClassification: "internal",
      scanner: new LinearDfaScanner([secret]),
      prepare: async () => {
        prepared += 1;
        return {
          planDigest: "prepared-without-effects",
          commit: async () => {
            committed += 1;
            return "sent";
          },
          discard: async () => {
            discarded += 1;
          },
        };
      },
    });

    expect((await stream.push("{\"token\":\"super-", false)).status).toBe(
      "pending",
    );
    expect(prepared).toBe(0);
    expect(committed).toBe(0);
    expect((await stream.push("secret-value\"}", true)).status).toBe("blocked");
    expect(prepared).toBe(1);
    expect(discarded).toBe(1);
    expect(committed).toBe(0);
    expect(records.list()).toHaveLength(0);
  });

  it("keeps values out of broker arguments and audit payloads", async () => {
    const records = new MemoryRecordAppender();
    const grants = new GrantManager(new EpochRegistry(records));
    const handle = grantHandle("grant:secret");
    grants.issue(makeGrantIssue(handle));
    const secrets = new OpaqueSecretStore();
    const value = "credential-that-must-not-leak";
    secrets.register({
      uri: "secret://provider/token",
      value,
      policy: {
        principal: principalId("principal"),
        destination: "https://example.com",
        operation: "request",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        rotation: "daily",
        injection: "broker-request",
      },
    });
    const broker = new CapabilityBroker(grants, records, secrets);
    await expect(broker.execute({
      invocation: makeInvocation(),
      handle,
      capability: "network.connect",
      resource: "https://example.com/api",
      frameClassification: "internal",
      destinationMaximumClassification: "internal",
      arguments: { token: value },
      execute: async () => "must-not-run",
    })).rejects.toThrow("registered secret");
    expect(JSON.stringify(records.list())).not.toContain(value);

    const response = await secrets.authenticatedRequest({
      uri: "secret://provider/token",
      principal: principalId("principal"),
      destination: "https://example.com",
      operation: "request",
      execute: async (secretValue) =>
        new Response(secretValue === value ? "authenticated" : "denied"),
    });
    expect(await response.text()).toBe("authenticated");
    expect(Object.keys(secrets)).toHaveLength(0);
  });
});
