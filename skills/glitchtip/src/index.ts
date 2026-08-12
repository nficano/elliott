import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type { GlitchTipTarget } from "./types";

// Default-on error reporting, attached with no core dependency on a reporter
// transport. Self-gates on settings.glitchtip: when reporting is disabled the
// block is absent (config `observability.glitchtip.enabled: false`) and
// register() returns before it imports any transport — it installs no sink,
// starts no service, opens no socket, and logs nothing. The envelope/sink
// modules are pulled in via dynamic import() only past that gate, so a disabled
// deployment never imports envelope.ts or sink.ts (only this entry module,
// which the loader must import to find register()). When enabled it attaches a
// bounded sink to the runtime error reporter and exposes a health service; the
// DSN it targets is the operator's own Sentry/GlitchTip or, with zero wiring,
// the bundled collector.
export const register = async (
  context: SkillContext,
): Promise<SkillRegistration> => {
  const settings = context.settings.glitchtip;
  if (settings === undefined) return {};
  const { parseDsn } = await import("./envelope");
  const { GlitchTipSink } = await import("./sink");
  let target: GlitchTipTarget;
  try {
    target = parseDsn(settings.dsn);
  } catch {
    // A malformed DSN degrades to the console baseline rather than crashing the
    // boot. The reported error is redacted so the DSN never reaches a log line
    // or a captured payload.
    context.report(
      new Error("glitchtip DSN could not be parsed; reporting disabled"),
      "glitchtip:config",
    );
    return {};
  }
  const sink = new GlitchTipSink({
    target,
    environment: context.settings.environment,
    release: context.settings.release,
  });
  context.installErrorSink(sink);
  return { services: [sink.service()] };
};
