import { createHash } from "node:crypto";
import { isJsonRecord } from "../../../src/providers/http";
import type { PiholeSettings } from "../../../src/runtime/types";
import type { CnameRecord, HostRecord, PiholeBackend } from "./types";

const REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NO_CONTENT = 204;
const HOSTS_PATH = "/api/config/dns/hosts";
const CNAME_PATH = "/api/config/dns/cnameRecords";
const CNAME_PARTS = 3;
const V5_API_PATH = "/admin/api.php";

// Pi-hole v6 answers POST /api/auth with JSON; v5's lighttpd serves an HTML
// page there. The content type is the discriminator, so one skill drives
// either API and survives a v5 -> v6 upgrade without reconfiguration.
export const detectBackend = async (
  settings: PiholeSettings,
): Promise<PiholeBackend> => {
  const response = await authenticate(settings);
  if (response.headers.get("content-type")?.includes("json") === true) {
    return v6Backend(settings, await sessionId(response));
  }
  return v5Backend(settings);
};

const authenticate = (settings: PiholeSettings): Promise<Response> =>
  fetch(new URL("/api/auth", settings.baseUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: settings.password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });

const sessionId = async (response: Response): Promise<string> => {
  const payload: unknown = await response.json();
  const session = isJsonRecord(payload) ? payload["session"] : undefined;
  const sid = isJsonRecord(session) ? session["sid"] : undefined;
  if (typeof sid !== "string" || sid.length === 0) {
    throw new Error("Pi-hole rejected the password");
  }
  return sid;
};

// v6: local DNS lives in the FTL config API as "ip domain..." host elements
// and "alias,target[,ttl]" CNAME elements, addressed by URL-encoded value.
// The sid is cached across calls and refreshed once on 401.
const v6Backend = (
  settings: PiholeSettings,
  initialSid: string,
): PiholeBackend => {
  let sid = initialSid;
  const call = (method: string, path: string, session: string) =>
    fetch(new URL(path, settings.baseUrl), {
      method,
      headers: { accept: "application/json", "x-ftl-sid": session },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
  const request = async (method: string, path: string): Promise<unknown> => {
    let response = await call(method, path, sid);
    if (response.status === HTTP_UNAUTHORIZED) {
      sid = await sessionId(await authenticate(settings));
      response = await call(method, path, sid);
    }
    if (!response.ok) {
      throw new Error(`Pi-hole returned HTTP ${response.status}`);
    }
    return response.status === HTTP_NO_CONTENT ? undefined : response.json();
  };
  const elements = async (path: string, key: string) =>
    configList(await request("GET", path), key);
  return {
    mode: "v6",
    snapshot: async () => ({
      hosts: parseHosts(await elements(HOSTS_PATH, "hosts")),
      cnames: parseCnames(await elements(CNAME_PATH, "cnameRecords")),
    }),
    addHost: async (ip, domain) => {
      await request("PUT", elementPath(HOSTS_PATH, `${ip} ${domain}`));
    },
    removeHost: async (record, domain) => {
      await request("DELETE", elementPath(HOSTS_PATH, hostElement(record)));
      const rest = record.domains.filter((item) => item !== domain);
      if (rest.length > 0) {
        const element = [record.ip, ...rest].join(" ");
        await request("PUT", elementPath(HOSTS_PATH, element));
      }
    },
    addCname: async (alias, target) => {
      await request("PUT", elementPath(CNAME_PATH, `${alias},${target}`));
    },
    removeCname: async (record) => {
      await request("DELETE", elementPath(CNAME_PATH, cnameElement(record)));
    },
  };
};

// v5: the AdminLTE PHP API. Records are (domain, ip) / (alias, target) rows
// and the auth token is the double-SHA256 of the admin password, so the same
// stored secret works for both backends.
const v5Backend = (settings: PiholeSettings): PiholeBackend => {
  const token = sha256Hex(sha256Hex(settings.password));
  const rows = async (endpoint: string) =>
    dataRows(await v5Call(settings, token, { [endpoint]: "", action: "get" }));
  const mutate = (params: Readonly<Record<string, string>>) =>
    v5Mutate(settings, token, params);
  return {
    mode: "v5",
    snapshot: async () => ({
      hosts: (await rows("customdns"))
        .map(([domain, ip]) => ({ ip, domains: [domain] })),
      cnames: (await rows("customcname"))
        .map(([alias, target]) => ({ alias, target })),
    }),
    addHost: (ip, domain) =>
      mutate({ customdns: "", action: "add", ip, domain }),
    removeHost: (record, domain) =>
      mutate({ customdns: "", action: "delete", ip: record.ip, domain }),
    addCname: (alias, target) =>
      mutate({ customcname: "", action: "add", domain: alias, target }),
    removeCname: (record) =>
      mutate({
        customcname: "",
        action: "delete",
        domain: record.alias,
        target: record.target,
      }),
  };
};

const v5Call = async (
  settings: PiholeSettings,
  token: string,
  params: Readonly<Record<string, string>>,
): Promise<unknown> => {
  const url = new URL(V5_API_PATH, settings.baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("auth", token);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });
  if (!response.ok) {
    throw new Error(`Pi-hole returned HTTP ${response.status}`);
  }
  const payload = parseV5Payload(await response.text());
  // api.php answers a bare [] when the token is wrong instead of an error.
  const rejected = Array.isArray(payload);
  if (rejected) throw new Error("Pi-hole rejected the API token");
  return payload;
};

// api.php can emit its default "[]" document *after* the handler's payload
// ("{...}[]" — observed live on Pi-hole v5.9), which breaks a strict JSON
// parse. Parse the whole body first, then retry without the stray trailer.
const V5_STRAY_TRAILER = "[]";

const parseV5Payload = (body: string): unknown => {
  const text = body.trim();
  try {
    return JSON.parse(text);
  } catch {
    if (text.endsWith(V5_STRAY_TRAILER)) {
      try {
        return JSON.parse(text.slice(0, -V5_STRAY_TRAILER.length));
      } catch {
        throw new Error("Pi-hole returned invalid JSON");
      }
    }
    throw new Error("Pi-hole returned invalid JSON");
  }
};

const v5Mutate = async (
  settings: PiholeSettings,
  token: string,
  params: Readonly<Record<string, string>>,
): Promise<void> => {
  const payload = await v5Call(settings, token, params);
  const success = isJsonRecord(payload) ? payload["success"] : undefined;
  if (success !== true) {
    const message = isJsonRecord(payload) ? payload["message"] : undefined;
    const detail = typeof message === "string" && message.length > 0
      ? `: ${message}`
      : "";
    throw new Error(`Pi-hole refused the change${detail}`);
  }
};

const configList = (payload: unknown, key: string): readonly string[] => {
  const config = isJsonRecord(payload) ? payload["config"] : undefined;
  const dns = isJsonRecord(config) ? config["dns"] : undefined;
  const value = isJsonRecord(dns) ? dns[key] : undefined;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};

const dataRows = (
  payload: unknown,
): readonly (readonly [string, string])[] => {
  const data = isJsonRecord(payload) ? payload["data"] : undefined;
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) =>
    Array.isArray(row) && typeof row[0] === "string"
      && typeof row[1] === "string"
      ? [[row[0], row[1]] as const]
      : []
  );
};

const parseHosts = (elements: readonly string[]): readonly HostRecord[] =>
  elements.flatMap((element) => {
    const [ip, ...domains] = element.trim().split(/\s+/);
    return ip === undefined || domains.length === 0 ? [] : [{ ip, domains }];
  });

const parseCnames = (elements: readonly string[]): readonly CnameRecord[] =>
  elements.flatMap((element) => {
    const [alias, target, ttl] = element.trim().split(",", CNAME_PARTS);
    if (alias === undefined || target === undefined) return [];
    return [{ alias, target, ...(ttl !== undefined && { ttl }) }];
  });

const hostElement = (record: HostRecord): string =>
  [record.ip, ...record.domains].join(" ");

const cnameElement = (record: CnameRecord): string =>
  [record.alias, record.target, ...record.ttl === undefined ? [] : [record.ttl]]
    .join(",");

const elementPath = (path: string, element: string): string =>
  `${path}/${encodeURIComponent(element)}`;

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
