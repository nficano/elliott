import type { BundledPackage } from "../../catalog/types";
import type { ToolDefinition } from "../types";
import type {
  GatewayBinding,
  LoadedSkill,
  RouteBinding,
  ServiceBinding,
  SkillContext,
  SkillRegistrar,
  SkillRegistration,
} from "./types";

export const loadSkillRegistrations = async (
  packages: readonly BundledPackage[],
  context: SkillContext,
): Promise<readonly LoadedSkill[]> => {
  const loaded: LoadedSkill[] = [];
  for (const item of packages) {
    if (item.entrypoint === undefined) continue;
    try {
      loaded.push({
        name: item.name,
        registration: await registerModule(item.entrypoint, context),
      });
    } catch (error) {
      context.report(error, `skill:${item.name}`);
    }
  }
  return loaded;
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
