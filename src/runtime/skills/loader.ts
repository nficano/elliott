import type { BundledPackage } from "../../catalog/types";
import type { ToolDefinition } from "../types";
import { RuntimeFacilityDirectory } from "./facilities";
import type {
  FacilityBinding,
  GatewayBinding,
  LoadedSkill,
  RouteBinding,
  ServiceBinding,
  SkillContext,
  SkillContextSeed,
  SkillPackageView,
  SkillRegistrar,
  SkillRegistration,
} from "./types";

// Two-pass registration: packages whose manifest declares spec.provides
// register first and their FacilityBindings populate the directory; everything
// else registers second with the populated directory on SkillContext, so
// consumers can acquire grants inside register(). Providers get a view whose
// acquire fails hard — provider→provider cycles are rejected at load.
export const loadSkillRegistrations = async (
  packages: readonly BundledPackage[],
  seed: SkillContextSeed,
): Promise<readonly LoadedSkill[]> => {
  const directory = new RuntimeFacilityDirectory(seed.stateDirectory);
  const providers = packages.filter((item) => item.provides.length > 0);
  const consumers = packages.filter((item) => item.provides.length === 0);
  const loaded: LoadedSkill[] = [];
  for (const item of providers) {
    const skill = await loadOne(item, {
      ...seed,
      facilities: directory.providerView(),
    });
    if (skill === undefined) continue;
    for (const binding of skill.registration.facilities ?? []) {
      directory.register(item.name, binding);
    }
    loaded.push(skill);
  }
  for (const item of consumers) {
    const skill = await loadOne(item, {
      ...seed,
      facilities: directory.scoped(item.name),
    });
    if (skill !== undefined) loaded.push(skill);
  }
  return loaded;
};

const loadOne = async (
  item: BundledPackage,
  context: SkillContext,
): Promise<LoadedSkill | undefined> => {
  if (item.entrypoint === undefined) return undefined;
  try {
    return {
      name: item.name,
      registration: await registerModule(item.entrypoint, context),
    };
  } catch (error) {
    context.report(error, `skill:${item.name}`);
    return undefined;
  }
};

const registerModule = async (
  entrypoint: string,
  context: SkillContext,
): Promise<SkillRegistration> => {
  const module: unknown = await import(entrypoint);
  const register = (module as { register?: unknown; }).register;
  if (typeof register !== "function") {
    throw new TypeError(`${entrypoint} does not export a register function`);
  }
  const registration: unknown = await (register as SkillRegistrar)(context);
  if (registration === null || typeof registration !== "object") {
    throw new TypeError(`${entrypoint} returned an invalid registration`);
  }
  return registration;
};

export const collectTools = (
  skills: readonly LoadedSkill[],
): readonly ToolDefinition[] => {
  const seen = new Map<string, string>();
  const tools: ToolDefinition[] = [];
  for (const skill of skills) {
    for (const tool of skill.registration.tools ?? []) {
      const owner = seen.get(tool.name);
      if (owner !== undefined) {
        throw new Error(
          `Tool ${tool.name} is exported by both ${owner} and ${skill.name}`,
        );
      }
      seen.set(tool.name, skill.name);
      tools.push(tool);
    }
  }
  return tools;
};

export const collectGateways = (
  skills: readonly LoadedSkill[],
): readonly GatewayBinding[] =>
  skills.flatMap((skill) => skill.registration.gateways ?? []);

export const collectRoutes = (
  skills: readonly LoadedSkill[],
): readonly RouteBinding[] =>
  skills.flatMap((skill) => skill.registration.routes ?? []);

export const collectServices = (
  skills: readonly LoadedSkill[],
): readonly ServiceBinding[] =>
  skills.flatMap((skill) => skill.registration.services ?? []);

export const collectFacilities = (
  skills: readonly LoadedSkill[],
): readonly FacilityBinding[] =>
  skills.flatMap((skill) => skill.registration.facilities ?? []);

const count = (bindings: readonly unknown[] | undefined): number =>
  bindings === undefined ? 0 : bindings.length;

const bindingCounts = (
  registration: SkillRegistration | undefined,
): SkillPackageView["bindings"] => ({
  tools: count(registration?.tools),
  gateways: count(registration?.gateways),
  routes: count(registration?.routes),
  services: count(registration?.services),
  facilities: count(registration?.facilities),
});

// Joins the static catalog with what actually registered, producing the
// per-package views SkillContext.packages() serves after boot. A package with
// no LoadedSkill either has no entrypoint or threw during register().
export const collectPackageViews = (
  packages: readonly BundledPackage[],
  skills: readonly LoadedSkill[],
): readonly SkillPackageView[] => {
  const registrations = new Map(
    skills.map((skill) => [skill.name, skill.registration]),
  );
  return packages.map((item) => {
    const registration = registrations.get(item.name);
    return {
      name: item.name,
      kind: item.kind,
      directory: item.directory,
      provides: item.provides.map((ref) => ref.facility),
      ...(item.topology !== undefined && { topology: item.topology }),
      registered: registration !== undefined,
      bindings: bindingCounts(registration),
    };
  });
};
