import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { digest } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { containerRuntimeProfile } from "../../src/placement/container-profile";
import { ResidencyRegistry } from "../../src/security/residency/residency";
import { makeCatalogEntry, makeResidencyGrant } from "../helpers";

const occurrences = (source: string, value: string): number =>
  source.split(value).length - 1;

describe("G21 residency probe and topology attestation", () => {
  it("revokes a leaking grant before rebuilding affected routes", async () => {
    const records = new MemoryRecordAppender();
    let rebuiltAfterRecord = false;
    const registry = new ResidencyRegistry(records, async () => {
      rebuiltAfterRecord = records.list().at(-1)?.type === "residency.revoked";
    });
    const grant = makeResidencyGrant("provider");
    await registry.register({
      grant,
      catalog: [makeCatalogEntry()],
      declaredTopologyDigest: grant.topologyDigest,
      probe: {
        tcpReachable: false,
        udpReachable: false,
        dnsReachable: false,
        observedTopologyDigest: grant.topologyDigest,
      },
    });
    await registry.applyProbe(grant.ref, {
      tcpReachable: false,
      udpReachable: true,
      dnsReachable: false,
      observedTopologyDigest: grant.topologyDigest,
    });
    expect(registry.get(grant.ref)?.revoked).toBe(true);
    expect(rebuiltAfterRecord).toBe(true);
  });

  it("fails registration when observed topology differs", async () => {
    const grant = makeResidencyGrant("drifted");
    const registry = new ResidencyRegistry(
      new MemoryRecordAppender(),
      async () => undefined,
    );
    await expect(registry.register({
      grant,
      catalog: [makeCatalogEntry()],
      declaredTopologyDigest: grant.topologyDigest,
      probe: {
        tcpReachable: false,
        udpReachable: false,
        dnsReachable: false,
        observedTopologyDigest: digest("different-topology"),
      },
    })).rejects.toThrow("diverges");
  });

  it("ships hardened containers with no runtime control socket", async () => {
    const compose = await readFile(
      new URL("../../deploy/compose.yml", import.meta.url),
      "utf8",
    );
    expect(compose).not.toContain("docker.sock");
    expect(compose).not.toContain("containerd.sock");
    expect(compose).not.toContain("podman.sock");
    expect(occurrences(compose, "read_only: true")).toBe(4);
    expect(occurrences(compose, "cap_drop: [ALL]")).toBe(4);
    expect(occurrences(compose, "no-new-privileges:true")).toBe(4);
    expect(occurrences(compose, "userns_mode: private")).toBe(4);
    expect(occurrences(compose, "seccomp=./seccomp/")).toBe(4);
    expect(occurrences(compose, "apparmor=elliott-")).toBe(4);
    const kernelSection = compose.slice(
      compose.indexOf("elliott-kernel:"),
      compose.indexOf("elliott-audit:"),
    );
    const auditSection = compose.slice(
      compose.indexOf("elliott-audit:"),
      compose.indexOf("component-pool:"),
    );
    expect(kernelSection).not.toContain("audit-data");
    expect(auditSection).toContain("audit-data:/elliott/audit");
    expect(containerRuntimeProfile().runtimeSocketMounted).toBe(false);
    expect(containerRuntimeProfile().seccompProfile).toBe(
      "deploy/seccomp/component.json",
    );
    expect(containerRuntimeProfile(true).runtimeClass).toBe("gvisor");
  });
});
