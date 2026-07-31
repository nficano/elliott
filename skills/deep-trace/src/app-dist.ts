import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { HTTP_OK } from "../../../src/runtime/http";
import type { RouteBinding } from "../../../src/runtime/skills/types";
import type { AppDistRoutes } from "./types";

// The Nuxt rewrite generates a finite static file list under app/dist. The
// runtime router matches exact paths, so each generated file becomes one
// route binding. When the build is absent the extension falls back to the
// legacy single-file UI.
const DIST_URL = new URL("../app/dist/", import.meta.url);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const IMMUTABLE_CACHE = "public, max-age=604800, immutable";
const HTML_CACHE = "no-cache";

const contentType = (file: string): string =>
  CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";

const fileResponse = async (file: string): Promise<Response> => {
  const bytes = await readFile(new URL(file, DIST_URL));
  const hashed = file.startsWith("_nuxt/");
  return new Response(bytes, {
    status: HTTP_OK,
    headers: {
      "content-type": contentType(file),
      "cache-control": hashed ? IMMUTABLE_CACHE : HTML_CACHE,
    },
  });
};

// Generated build files stay out of the OpenAPI document.
const HIDDEN = { hidden: true } as const;

const routeFor = (base: string, file: string): RouteBinding => ({
  method: "GET",
  path: `${base}/${file}`,
  docs: HIDDEN,
  handle: () => fileResponse(file),
});

// List the generated files (relative, forward-slash) or [] without a build.
export const appDistFiles = async (): Promise<readonly string[]> => {
  try {
    const entries = await readdir(DIST_URL, {
      recursive: true,
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path
          .relative(
            DIST_URL.pathname,
            path.join(entry.parentPath, entry.name),
          )
          .replaceAll(path.sep, "/")
      )
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
};

// Build one exact-match route per generated asset plus the SPA index handler
// served at the extension base (and base + "/").
export const appDistRoutes = async (base: string): Promise<AppDistRoutes> => {
  const files = await appDistFiles();
  if (!files.includes("index.html")) return { routes: [], index: undefined };
  const index = (): Promise<Response> => fileResponse("index.html");
  const routes = [
    ...files.map((file) => routeFor(base, file)),
    { method: "GET", path: `${base}/`, docs: HIDDEN, handle: () => index() },
  ];
  return { routes, index };
};
