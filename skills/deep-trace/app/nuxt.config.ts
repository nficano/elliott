import tailwindcss from "@tailwindcss/vite";
import { defineNuxtConfig } from "nuxt/config";

// The map is an operator tool served from the elliott runtime at
// 127.0.0.1:18082 under /v1/observability/map. It renders an isometric canvas
// with browser-only APIs throughout, so it ships as a client-only SPA; the
// extension serves the generated file list through exact-match routes.
export default defineNuxtConfig({
  compatibilityDate: "2026-07-01",
  devtools: { enabled: false },
  ssr: false,
  app: {
    baseURL: "/v1/observability/map/",
    head: {
      title: "Deep-trace — Runtime Topology",
      htmlAttrs: { lang: "en" },
      meta: [
        // The HTML meta charset token is dash-separated by spec.
        // eslint-disable-next-line unicorn/text-encoding-identifier-case
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      ],
      link: [{ rel: "icon", href: "data:," }],
    },
  },
  // First paint matches the scene background instead of flashing white.
  spaLoadingTemplate: "spa-loading-template.html",
  css: ["~/assets/css/main.css"],
  vite: {
    plugins: [tailwindcss()],
  },
  typescript: {
    typeCheck: false,
    strict: true,
  },
  nitro: {
    preset: "static",
  },
});
