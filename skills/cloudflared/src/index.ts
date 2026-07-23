import type {
  ServiceBinding,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type { CloudflaredSettings } from "../../../src/runtime/types";

const POLL_INTERVAL_MILLISECONDS = 60_000;
const PROBE_TIMEOUT_MILLISECONDS = 5000;

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.cloudflared;
  return settings === undefined
    ? {}
    : { services: [healthChecker(settings, context)] };
};

const healthChecker = (
  settings: CloudflaredSettings,
  context: SkillContext,
): ServiceBinding => {
  let timer: ReturnType<typeof setInterval> | undefined;
  let ready = 0;
  let checks = 0;
  const probe = async (): Promise<void> => {
    checks += 1;
    try {
      const response = await fetch(settings.readyUrl, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MILLISECONDS),
      });
      const wasReady = ready;
      ready = response.ok ? 1 : 0;
      if (wasReady === 1 && ready === 0) {
        context.report(
          new Error(`cloudflared tunnel not ready: HTTP ${response.status}`),
          "cloudflared:health",
        );
      }
    } catch (error) {
      if (ready === 1) context.report(error, "cloudflared:health");
      ready = 0;
    }
  };
  return {
    name: "cloudflared",
    start: () => {
      void probe();
      timer = setInterval(() => void probe(), POLL_INTERVAL_MILLISECONDS);
    },
    stop: () => {
      if (timer !== undefined) clearInterval(timer);
    },
    health: () => ({ ready, checks }),
  };
};
