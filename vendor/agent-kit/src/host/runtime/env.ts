import * as Context from "effect/Context";
import type { RuntimeEnv } from "./types.js";

export class RuntimeEnvSvc
  extends Context.Service<RuntimeEnvSvc, RuntimeEnv>()("RuntimeEnv")
{}
