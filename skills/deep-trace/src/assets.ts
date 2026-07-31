import { readFile } from "node:fs/promises";
import { HTTP_NOT_FOUND, HTTP_OK } from "../../../src/runtime/http";
import type { RouteBinding } from "../../../src/runtime/skills/types";

// Bundled fonts and brand icons served through the extension so the UI stays
// self-contained (egress: none).
const WEEK_CACHE = "public, max-age=604800";

const ICONS = [
  "browser",
  "gmail",
  "home-assistant",
  "imessage",
  "litellm",
  "ollama",
  "postgresql",
  "vault",
] as const;

const fontResponse = async (file: string): Promise<Response> => {
  try {
    const bytes = await readFile(new URL(`fonts/${file}`, import.meta.url));
    return new Response(bytes, {
      status: HTTP_OK,
      headers: { "content-type": "font/woff2", "cache-control": WEEK_CACHE },
    });
  } catch {
    return new Response("font missing", { status: HTTP_NOT_FOUND });
  }
};

const iconResponse = async (file: string): Promise<Response> => {
  try {
    const bytes = await readFile(new URL(`icons/${file}`, import.meta.url));
    return new Response(bytes, {
      status: HTTP_OK,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": WEEK_CACHE,
      },
    });
  } catch {
    return new Response("icon missing", { status: HTTP_NOT_FOUND });
  }
};

// Static assets stay out of the generated OpenAPI document.
const HIDDEN = { hidden: true } as const;

export const assetRoutes = (base: string): readonly RouteBinding[] => [
  {
    method: "GET",
    path: `${base}/font/display`,
    docs: HIDDEN,
    handle: () => fontResponse("generation_1970_light.woff2"),
  },
  {
    method: "GET",
    path: `${base}/font/body`,
    docs: HIDDEN,
    handle: () => fontResponse("inter-variable.woff2"),
  },
  ...ICONS.map((icon): RouteBinding => ({
    method: "GET",
    path: `${base}/icon/${icon}`,
    docs: HIDDEN,
    handle: () => iconResponse(`${icon}.svg`),
  })),
];
