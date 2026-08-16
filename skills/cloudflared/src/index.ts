import type {
  ServiceBinding,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type { CloudflaredSettings } from "../../../src/runtime/types";
import { cloudflareApi } from "./api";
import { writeConnectorToken } from "./handoff";
import { probeTunnel } from "./probe";
import { fetchConnectorToken, reconcileTunnel } from "./reconcile";
import type {
  TunnelProbeDependencies,
  TunnelProvisionState,
  TunnelWatchState,
} from "./types";

const SERVICE_NAME = "cloudflared";
const PROBE_INTERVAL_MILLISECONDS = 30_000;
const READY = 1;
const NOT_READY = 0;
// No probe has run yet; distinguishable from a real timestamp, which is always
// far in the past relative to the epoch only at t=0.
const NEVER_CHECKED_MILLISECONDS = 0;

// The tunnel is the only reason a public webhook URL resolves to this runtime.
// Nothing in elliott owned that fact before: webhook-provisioner mints
// `<hooksBaseUrl>/w/<slug>` and gateway-slack hands it to Slack, but if the
// tunnel is down every delivery is dropped at Cloudflare's edge and the runtime
// never learns. This registers the dependency so a dead tunnel is visible in
// /healthz and reported through the error sink, instead of silent.
//
// The process itself is NOT managed here. cloudflared runs as its own container
// in the deployment, supervised by compose; exec'ing a binary that opens public
// ingress is a capability this framework deliberately does not take.
export const register = (
  context: SkillContext,
  dependencies?: Partial<TunnelProbeDependencies>,
): SkillRegistration => {
  const settings = context.settings.cloudflared;
  if (settings === undefined) return {};
  return {
    services: [
      tunnelWatch(settings, context, {
        probe: dependencies?.probe ?? probeTunnel,
        now: dependencies?.now ?? (() => Date.now()),
        schedule: dependencies?.schedule ?? defaultSchedule,
        provision: dependencies?.provision ?? defaultProvision,
      }),
    ],
  };
};

// Provision on start when the credential set is complete. The connector token
// is fetched but NEVER returned into the runtime's own state: it is written to
// the handoff file for the sidecar and dropped. Returning it would place a
// credential on an object the report path can reach.
const defaultProvision = async (
  settings: CloudflaredSettings,
  input: { servicePort: number; stateDirectory: string; },
): Promise<TunnelProvisionState | undefined> => {
  if (
    settings.apiToken === undefined || settings.accountId === undefined
    || settings.zoneId === undefined || settings.hostname === undefined
  ) return undefined;
  const credentials = {
    apiToken: settings.apiToken,
    accountId: settings.accountId,
    zoneId: settings.zoneId,
  };
  const api = cloudflareApi(credentials);
  const state = await reconcileTunnel(api, credentials, {
    hostname: settings.hostname,
    servicePort: input.servicePort,
  });
  if (state === undefined) return undefined;
  const token = await fetchConnectorToken(api, credentials, state.tunnelId);
  if (token !== undefined) {
    await writeConnectorToken(input.stateDirectory, token);
  }
  return state;
};

const defaultSchedule = (
  tick: () => void,
  intervalMilliseconds: number,
): () => void => {
  const timer = setInterval(tick, intervalMilliseconds);
  // Do not hold the process open on this timer alone.
  timer.unref?.();
  return () => clearInterval(timer);
};

const initialState = (): TunnelWatchState => ({
  ready: false,
  readyConnections: 0,
  consecutiveFailures: 0,
  checks: 0,
  lastCheckMs: NEVER_CHECKED_MILLISECONDS,
});

// One probe, folded into the running state. Reports only on the DOWN
// transition, not on every failed poll: a tunnel that stays down for an hour is
// one incident, and a 30s poll would otherwise emit 120 identical events into
// the error sink — and, with glitchtip attached, off-box.
const runCheck = async (
  state: TunnelWatchState,
  watch: {
    readonly readyUrl: string;
    readonly context: SkillContext;
    readonly dependencies: TunnelProbeDependencies;
  },
): Promise<TunnelWatchState> => {
  const { readyUrl, context, dependencies } = watch;
  const result = await dependencies.probe(readyUrl);
  const next: TunnelWatchState = {
    ready: result.ready,
    readyConnections: result.readyConnections,
    consecutiveFailures: result.ready ? 0 : state.consecutiveFailures + 1,
    checks: state.checks + 1,
    lastCheckMs: dependencies.now(),
  };
  const newlyDown = !result.ready
    && (state.ready || next.consecutiveFailures === 1);
  if (newlyDown) {
    context.report(
      new Error(
        `cloudflared tunnel is not ready: ${result.reason ?? "unknown"}. `
          + "Inbound webhooks will not reach this runtime.",
      ),
      `skill:${SERVICE_NAME}`,
    );
  }
  return next;
};

// Provision, then say only what is worth saying: the changes a boot actually
// made, or a loud failure when provisioning was configured and did not work. A
// steady-state boot is silent — an operator who sees a line every restart stops
// reading them.
const runProvision = async (
  settings: CloudflaredSettings,
  context: SkillContext,
  dependencies: TunnelProbeDependencies,
): Promise<boolean> => {
  const result = await dependencies.provision(settings, {
    servicePort: context.settings.port,
    stateDirectory: context.stateDirectory,
  });
  if (result !== undefined && result.changes.length > 0) {
    context.report(
      new Error(
        `cloudflared provisioned ${result.hostname}: ${
          result.changes.join("; ")
        }`,
      ),
      `skill:${SERVICE_NAME}`,
    );
  }
  if (settings.hostname !== undefined && result === undefined) {
    context.report(
      new Error(
        "cloudflared could not provision its tunnel; "
          + "inbound webhooks will not reach this runtime.",
      ),
      `skill:${SERVICE_NAME}`,
    );
  }
  return result !== undefined;
};

const tunnelWatch = (
  settings: CloudflaredSettings,
  context: SkillContext,
  dependencies: TunnelProbeDependencies,
): ServiceBinding => {
  let cancel: (() => void) | undefined;
  let started = false;
  let provisioned = false;
  let state = initialState();
  const readyUrl = settings.readyUrl;

  const check = async (): Promise<void> => {
    if (readyUrl === undefined) return;
    state = await runCheck(state, { readyUrl, context, dependencies });
  };

  return {
    name: SERVICE_NAME,
    start: async () => {
      // Idempotent: a second start() without a stop() must not strand the first
      // interval, which would double the poll rate and leak on every restart.
      if (started) return;
      started = true;
      // Provision BEFORE probing: on a cold account the tunnel does not exist
      // yet, so a probe first would report a failure the next few seconds fix.
      provisioned = await runProvision(settings, context, dependencies);
      if (readyUrl === undefined) return;
      // Probe once before returning so a tunnel that is already down is
      // reported at boot rather than up to one interval later.
      await check();
      cancel = dependencies.schedule(
        () => void check(),
        PROBE_INTERVAL_MILLISECONDS,
      );
    },
    stop: () => {
      cancel?.();
      cancel = undefined;
      started = false;
    },
    health: () => ({
      provisioned: provisioned ? READY : NOT_READY,
      ready: state.ready ? READY : NOT_READY,
      readyConnections: state.readyConnections,
      consecutiveFailures: state.consecutiveFailures,
      checks: state.checks,
      lastCheckMs: state.lastCheckMs,
    }),
  };
};
