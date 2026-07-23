import type { ContainerRuntimeProfile } from "./types";

export const containerRuntimeProfile = (
  regulated = false,
  componentClass = "component",
): ContainerRuntimeProfile =>
  regulated
    ? {
      readOnlyRootFilesystem: true,
      tmpfsScratch: true,
      capabilitiesDropped: "ALL",
      noNewPrivileges: true,
      userNamespace: true,
      seccompProfile: `deploy/seccomp/${componentClass}.json`,
      appArmorProfile: `elliott-${componentClass}`,
      runtimeSocketMounted: false,
      runtimeClass: "gvisor",
    }
    : {
      readOnlyRootFilesystem: true,
      tmpfsScratch: true,
      capabilitiesDropped: "ALL",
      noNewPrivileges: true,
      userNamespace: true,
      seccompProfile: `deploy/seccomp/${componentClass}.json`,
      appArmorProfile: `elliott-${componentClass}`,
      runtimeSocketMounted: false,
    };
