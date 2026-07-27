import type { SkillContext } from "../../../src/runtime/skills/types";
import type { YouTubeDvrProviderRef } from "../../../src/runtime/types";
import { makePakmanResolver } from "../../pakman-latest-episode/src/resolver";
import type { SourceProvider } from "./types";

// The DVR consults a configured list of source providers for shows that the
// YouTube Data API does not surface. Each ref names a provider the runtime
// knows how to build in-process; unknown names and providers whose credentials
// are absent are skipped rather than failing the run.
export const buildProviders = (
  refs: readonly YouTubeDvrProviderRef[],
  context: SkillContext,
): readonly SourceProvider[] =>
  refs.flatMap((ref) => {
    const provider = makeProvider(ref, context);
    return provider === undefined ? [] : [provider];
  });

const makeProvider = (
  ref: YouTubeDvrProviderRef,
  context: SkillContext,
): SourceProvider | undefined => {
  if (ref.name === "pakman") return pakmanProvider(ref, context);
  return undefined;
};

const pakmanProvider = (
  ref: YouTubeDvrProviderRef,
  context: SkillContext,
): SourceProvider | undefined => {
  const credentials = context.settings.pakman;
  if (credentials === undefined) return undefined;
  const resolver = makePakmanResolver(credentials);
  return {
    name: ref.name,
    days: ref.days,
    resolve: async () => (await resolver.latest()).url,
  };
};
