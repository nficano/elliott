import { stripActiveContent } from "../../../src/catalog/guards";
import type {
  JarRequest,
  PakmanCredentials,
  PakmanEpisode,
  PakmanResolver,
} from "./types";

// The David Pakman Show full episodes sit behind a WooCommerce member login on
// davidpakman.com. Endpoint/field names below are the WordPress + WooCommerce
// defaults; adjust if the site's membership plugin changes. All fetched markup
// is untrusted data — we only ever extract a YouTube video id from it.
const SITE = "https://www.davidpakman.com";
const LOGIN_PATH = "/my-account/";
const SHOWS_PATH = "/members/full-episodes/";
const MAX_REDIRECTS = 5;
const REDIRECT_MIN = 300;
const REDIRECT_MAX = 399;
const YOUTUBE_PATTERN =
  /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/g;
const NONCE_PATTERN = /name="woocommerce-login-nonce"\s+value="([\w-]+)"/;

export const makePakmanResolver = (
  credentials: PakmanCredentials,
): PakmanResolver => ({
  latest: async () => {
    const jar = new Map<string, string>();
    await login(jar, credentials);
    const listing = await fetchWithJar(`${SITE}${SHOWS_PATH}`, jar, {
      method: "GET",
    });
    const episode = firstEpisode(stripActiveContent(await safeText(listing)));
    if (episode === undefined) {
      throw new Error("No full-episode video was found on davidpakman.com");
    }
    return episode;
  },
});

const login = async (
  jar: Map<string, string>,
  credentials: PakmanCredentials,
): Promise<void> => {
  const page = await fetchWithJar(`${SITE}${LOGIN_PATH}`, jar, {
    method: "GET",
  });
  const nonce = NONCE_PATTERN.exec(await safeText(page))?.[1];
  const body = new URLSearchParams({
    username: credentials.username,
    password: credentials.password,
    login: "Log in",
    ...(nonce !== undefined && { "woocommerce-login-nonce": nonce }),
  }).toString();
  await fetchWithJar(`${SITE}${LOGIN_PATH}`, jar, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
};

const fetchWithJar = async (
  url: string,
  jar: Map<string, string>,
  init: JarRequest,
): Promise<Response> => {
  let current = url;
  let request = init;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const cookie = cookieHeader(jar);
    const response = await fetch(current, {
      method: request.method,
      redirect: "manual",
      headers: { ...request.headers, ...(cookie.length > 0 && { cookie }) },
      ...(request.body !== undefined && { body: request.body }),
    });
    for (const raw of response.headers.getSetCookie()) mergeCookie(jar, raw);
    const location = response.headers.get("location");
    if (!isRedirect(response.status) || location === null) return response;
    current = new URL(location, current).href;
    request = { method: "GET" };
  }
  throw new Error("Too many redirects from davidpakman.com");
};

const isRedirect = (status: number): boolean =>
  status >= REDIRECT_MIN && status <= REDIRECT_MAX;

const mergeCookie = (jar: Map<string, string>, raw: string): void => {
  const pair = raw.split(";", 1)[0]?.trim() ?? "";
  const separator = pair.indexOf("=");
  if (separator > 0) {
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
};

const cookieHeader = (jar: Map<string, string>): string =>
  [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

const firstEpisode = (html: string): PakmanEpisode | undefined => {
  const match = [...html.matchAll(YOUTUBE_PATTERN)][0];
  const videoId = match?.[1];
  if (videoId === undefined) return undefined;
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
};

const safeText = async (response: Response): Promise<string> => {
  if (!response.ok) {
    throw new Error(`davidpakman.com returned HTTP ${response.status}`);
  }
  return response.text();
};
