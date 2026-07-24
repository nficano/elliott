import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BundledPackage } from "../catalog/types";
import { componentRef } from "../core/brands";
import { hashValue } from "../core/digest";
import type { Snapshot } from "../core/snapshot/types";
import type { RuntimeSettings, RuntimeSnapshotInput } from "./types";

const packageView = async (item: BundledPackage) => {
  const files = [
    "component.yaml",
    item.document,
    ...item.exports.map((entry) => entry.implementation),
  ];
  const bytes = await Promise.all(
    files.map((file) => readFile(path.join(item.directory, file), "utf8")),
  );
  return {
    name: item.name,
    kind: item.kind,
    profile: item.profile,
    protocols: item.protocols,
    exports: item.exports,
    packageDigest: hashValue({ files, bytes }),
  };
};

const publicConfiguration = (
  settings: RuntimeSettings,
  targetCatalogDigest: string | undefined,
) => ({
  environment: settings.environment,
  release: settings.release,
  timezone: settings.timezone,
  model: settings.model,
  browserAllowedDomains: settings.browser.allowedDomains,
  evolution: settings.evolution,
  targetCatalogDigest,
});

export const ensureRuntimeSnapshot = async (
  input: RuntimeSnapshotInput,
): Promise<Snapshot> => {
  const { packages, root, settings, store } = input;
  const registry = await Promise.all(packages.map(packageView));
  const targetCatalogPath = path.join(
    root,
    ".elliott/evolution-targets.yaml",
  );
  const targetCatalogDigest = settings.evolution === undefined
    ? undefined
    : hashValue(await readFile(targetCatalogPath, "utf8"));
  const configuration = publicConfiguration(settings, targetCatalogDigest);
  const configurationDigest = hashValue(configuration);
  const registryDigest = hashValue(registry);
  const existing = store.list().findLast((snapshot) =>
    snapshot.configurationDigest === configurationDigest
    && snapshot.registryDigest === registryDigest
  );
  if (existing !== undefined) return existing;
  return store.create({
    configurationDigest,
    registryDigest,
    configuration,
    components: registry.flatMap((item) => {
      const refs = item.exports.length === 0
        ? [`${item.profile}/${item.kind}/${item.name}`]
        : item.exports.map((entry) => entry.ref);
      return refs.map((reference) => ({
        ref: componentRef(reference),
        manifestDigest: item.packageDigest,
        configDigest: hashValue({ profile: item.profile }),
      }));
    }),
  });
};
