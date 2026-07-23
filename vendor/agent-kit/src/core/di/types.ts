import type * as Context from "effect/Context";

/**
 * The service-locator accessor exposed to registrables (`ActivateCtx.get`) and
 * consumers (`AgentKit.get`). Reads a service out of the app `Context` by its
 * key and throws when the service was not provided.
 */
export type ServiceGet = <I, S>(key: Context.Key<I, S>) => S;
