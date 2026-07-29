import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "../../../skills/telemetry-map/src/index";
import type { MapSnapshot } from "../../../skills/telemetry-map/src/types";
import { standaloneFacilityDirectory } from "../../../src/runtime/skills/facilities";
import type {
  GatewayEvents,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type { RuntimeSettings } from "../../../src/runtime/types";

const BASE = "/v1/observability/map";
const ORIGIN = "http://127.0.0.1:18082";
const root = path.resolve(import.meta.dir, "../../..");

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const makeContext = async (): Promise<
  { context: SkillContext; reported: unknown[]; }
> => {
  const stateDirectory = await mkdtemp(
    path.join(tmpdir(), "telemetry-map-routes-"),
  );
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));
  const reported: unknown[] = [];
  const settings = {
    environment: "test",
    release: "0.0.0-test",
    model: "test-model",
  } as RuntimeSettings;
  const context: SkillContext = {
    settings,
    stateDirectory,
    facilities: standaloneFacilityDirectory(),
    report: (error) => {
      reported.push(error);
    },
    deliver: async () => {},
  };
  return { context, reported };
};

const makeRegistration = async (): Promise<SkillRegistration> => {
  const { context } = await makeContext();
  return register(context);
};

const idleEvents: GatewayEvents = {
  onMessage: async () => {},
  onFeedback: async () => {},
  onError: () => {},
};

const dispatch = async (
  registration: SkillRegistration,
  method: string,
  pathname: string,
  init: RequestInit = {},
  events: GatewayEvents = idleEvents,
): Promise<Response> => {
  const route = registration.routes?.find(
    (candidate) => candidate.method === method && candidate.path === pathname,
  );
  expect(route).toBeDefined();
  const url = `${ORIGIN}${pathname}`;
  return route!.handle(new Request(url, { method, ...init }), events);
};

describe("telemetry-map registration", () => {
  it("registers one capture gateway, one background service, and the route table", async () => {
    const registration = await makeRegistration();
    expect(registration.gateways?.length).toBe(1);
    expect(registration.gateways?.[0]?.name).toBe("telemetry-map");
    expect(registration.services?.length).toBe(1);
    expect(registration.services?.[0]?.name).toBe("telemetry-map");
    expect(registration.tools).toBeUndefined();
    const table = (registration.routes ?? []).map(
      (route) => `${route.method} ${route.path}`,
    );
    expect(table).toEqual(expect.arrayContaining([
      `GET ${BASE}`,
      `GET ${BASE}/legacy`,
      `GET ${BASE}/topology`,
      `GET ${BASE}/state`,
      `GET ${BASE}/stream`,
      `GET ${BASE}/turn`,
      `GET ${BASE}/font/display`,
      `GET ${BASE}/font/body`,
      `GET ${BASE}/icon/browser`,
      `GET ${BASE}/icon/gmail`,
      `GET ${BASE}/icon/home-assistant`,
      `GET ${BASE}/icon/imessage`,
      `GET ${BASE}/icon/litellm`,
      `GET ${BASE}/icon/ollama`,
      `GET ${BASE}/icon/postgresql`,
      `GET ${BASE}/icon/vault`,
      `POST ${BASE}/send`,
    ]));
  });
});

describe("GET /v1/observability/map", () => {
  it("serves an HTML explorer UI at the base path", async () => {
    const registration = await makeRegistration();
    const response = await dispatch(registration, "GET", BASE);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    const html = (await response.text()).toLowerCase();
    expect(html).toContain("<!doctype html>");
  });

  it("always serves the legacy single-file UI at /legacy", async () => {
    const registration = await makeRegistration();
    const response = await dispatch(registration, "GET", `${BASE}/legacy`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    const html = await response.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Elliott");
    expect(html).toContain(`const BASE = "${BASE}"`);
  });

  it("serves the Nuxt build (with assets) when app/dist exists", async () => {
    const registration = await makeRegistration();
    const table = (registration.routes ?? []).map((route) => route.path);
    const hasBuild = table.some((routePath) =>
      routePath.startsWith(`${BASE}/_nuxt/`)
    );
    if (!hasBuild) return; // legacy-only checkout: nothing more to verify
    const response = await dispatch(registration, "GET", BASE);
    const html = await response.text();
    expect(html).toContain("/_nuxt/");
    expect(table).toContain(`${BASE}/`);
    const asset = table.find((routePath) =>
      routePath.startsWith(`${BASE}/_nuxt/`) && routePath.endsWith(".js")
    );
    expect(asset).toBeDefined();
    const assetResponse = await dispatch(registration, "GET", asset!);
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(assetResponse.headers.get("cache-control")).toContain("immutable");
  });
});

describe("GET /v1/observability/map/topology", () => {
  it("serves the enriched topology JSON verbatim", async () => {
    const registration = await makeRegistration();
    const response = await dispatch(registration, "GET", `${BASE}/topology`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.text();
    const onDisk = await readFile(
      path.join(root, "docs/elliott-topology.enriched.json"),
      "utf8",
    );
    expect(body).toBe(onDisk);
  });
});

describe("GET /v1/observability/map/state", () => {
  it("returns the current snapshot with runtime meta", async () => {
    const registration = await makeRegistration();
    const response = await dispatch(registration, "GET", `${BASE}/state`);
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as MapSnapshot;
    expect(snapshot.meta).toMatchObject({
      environment: "test",
      release: "0.0.0-test",
      configuredModel: "test-model",
    });
    expect(typeof snapshot.meta.promptsEnabled).toBe("boolean");
    expect(Array.isArray(snapshot.turns)).toBe(true);
    expect(Array.isArray(snapshot.events)).toBe(true);
    expect(snapshot.db).toMatchObject({ tables: [], recent: {} });
    expect(new Date(snapshot.generatedAt).toString()).not.toBe("Invalid Date");
  });
});

describe("GET /v1/observability/map/turn", () => {
  it("rejects a request without an id", async () => {
    const registration = await makeRegistration();
    const response = await dispatch(registration, "GET", `${BASE}/turn`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "missing id" });
  });

  it("returns an empty event list for an unknown id", async () => {
    const registration = await makeRegistration();
    const route = registration.routes?.find(
      (candidate) => candidate.path === `${BASE}/turn`,
    );
    const response = await route!.handle(
      new Request(`${ORIGIN}${BASE}/turn?id=run-unknown`),
      idleEvents,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runId: "run-unknown",
      events: [],
    });
  });
});

describe("GET /v1/observability/map/stream", () => {
  it("opens an SSE stream with the opening comment", async () => {
    const registration = await makeRegistration();
    const response = await dispatch(registration, "GET", `${BASE}/stream`);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe(
      ": telemetry-map stream open\n\n",
    );
    await reader.cancel();
  });
});

describe("static asset routes", () => {
  it("serves both display and body fonts as cacheable woff2", async () => {
    const registration = await makeRegistration();
    for (const name of ["display", "body"]) {
      const response = await dispatch(
        registration,
        "GET",
        `${BASE}/font/${name}`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("font/woff2");
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=604800",
      );
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  });

  it("serves every registered brand icon as cacheable SVG", async () => {
    const registration = await makeRegistration();
    const icons = [
      "browser",
      "gmail",
      "home-assistant",
      "imessage",
      "litellm",
      "ollama",
      "postgresql",
      "vault",
    ];
    for (const icon of icons) {
      const response = await dispatch(
        registration,
        "GET",
        `${BASE}/icon/${icon}`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "image/svg+xml; charset=utf-8",
      );
      expect(await response.text()).toContain("<svg");
    }
  });
});

describe("POST /v1/observability/map/send", () => {
  const sendRequest = (body: string): RequestInit => ({
    body,
    headers: { "content-type": "application/json" },
  });

  it("rejects a body that is not JSON", async () => {
    const registration = await makeRegistration();
    const response = await dispatch(
      registration,
      "POST",
      `${BASE}/send`,
      sendRequest("not json"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid json" });
  });

  it("rejects a missing or blank text field", async () => {
    const registration = await makeRegistration();
    for (const body of ["{}", "{\"text\": \"   \"}", "{\"text\": 7}"]) {
      const response = await dispatch(
        registration,
        "POST",
        `${BASE}/send`,
        sendRequest(body),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "text is required" });
    }
  });

  it("injects the message and returns the captured agent answer", async () => {
    const registration = await makeRegistration();
    const gateway = registration.gateways![0]!;
    const seen: unknown[] = [];
    const events: GatewayEvents = {
      onMessage: async (message) => {
        seen.push(message);
        const response = await gateway.beginResponse!(message);
        await response.complete(`echo: ${message.text}`);
      },
      onFeedback: async () => {},
      onError: () => {},
    };
    const response = await dispatch(
      registration,
      "POST",
      `${BASE}/send`,
      sendRequest("{\"text\": \"hello map\"}"),
      events,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: "echo: hello map" });
    expect(seen.length).toBe(1);
    expect(seen[0]).toMatchObject({
      gateway: "telemetry-map",
      channel: "telemetry-map:interactive",
      sender: "map-observer",
      text: "hello map",
    });
    expect((seen[0] as { id: string; }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("honours a caller-provided sender and reports failures as the answer", async () => {
    const registration = await makeRegistration();
    const gateway = registration.gateways![0]!;
    const events: GatewayEvents = {
      onMessage: async (message) => {
        expect(message.sender).toBe("playwright");
        const response = await gateway.beginResponse!(message);
        await response.fail("the model is unavailable");
      },
      onFeedback: async () => {},
      onError: () => {},
    };
    const response = await dispatch(
      registration,
      "POST",
      `${BASE}/send`,
      sendRequest("{\"text\": \"hi\", \"sender\": \"playwright\"}"),
      events,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      answer: "the model is unavailable",
    });
  });
});

describe("telemetry-map service", () => {
  it("starts, reports aggregator health, and stops cleanly", async () => {
    const registration = await makeRegistration();
    const service = registration.services![0]!;
    await service.start();
    try {
      const health = service.health!();
      expect(typeof health["turns"]).toBe("number");
      expect(typeof health["events"]).toBe("number");
      expect(typeof health["clients"]).toBe("number");
      expect(typeof health["dbTables"]).toBe("number");
    } finally {
      await service.stop();
    }
  });

  it("streams live runtime telemetry to SSE clients once started", async () => {
    const registration = await makeRegistration();
    const service = registration.services![0]!;
    await service.start();
    try {
      const response = await dispatch(registration, "GET", `${BASE}/stream`);
      const reader = response.body!.getReader();
      const { value: opening } = await reader.read();
      expect(new TextDecoder().decode(opening)).toContain("stream open");
      const { runtimeTelemetry } = await import(
        "../../../src/runtime/telemetry"
      );
      runtimeTelemetry.emit("turn.begin", { conversation: "c-1" }, "run-live");
      const { value: frame } = await reader.read();
      const text = new TextDecoder().decode(frame);
      expect(text).toStartWith("event: turn.begin\n");
      expect(text).toContain("run-live");
      await reader.cancel();
      const state = await dispatch(registration, "GET", `${BASE}/state`);
      const snapshot = (await state.json()) as MapSnapshot;
      expect(snapshot.turns.some((turn) => turn.runId === "run-live")).toBe(
        true,
      );
    } finally {
      await service.stop();
    }
  });
});
