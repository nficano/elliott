import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import { parseDsn } from "./envelope";
import { GlitchTipSink } from "./sink";
import type { GlitchTipTarget } from "./types";

// Default-on error reporting, attached with no core dependency on a reporter
// transport. Self-gates on settings.glitchtip: when reporting is disabled the
// block is absent (config `observability.glitchtip.enabled: false`) and
// register() is a pure no-op — it installs no sink, starts no service, opens no
// socket, and logs nothing. A disabled deployment therefore shows no trace of
// glitchtip at boot. When enabled it attaches a bounded sink to the runtime
// error reporter and exposes a health service; the DSN it targets is the
// operator's own Sentry/GlitchTip or, with zero wiring, the bundled collector.
export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.glitchtip;
  if (settings === undefined) return {};
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
