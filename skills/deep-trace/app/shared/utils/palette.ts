import type { ExplorerNode } from "../types/explorer";

// Three circuit-trace accents carry all category identity (legacy parity).
export const DOMAIN_COLOR: Readonly<Record<string, string>> = {
  "secrets": "#ffbd3f",
  "ingress": "#35d6ff",
  "agent-core": "#39ff88",
  "model-inference": "#35d6ff",
  "tool-execution": "#39ff88",
  "external-integrations": "#35d6ff",
  "mcp-federation": "#39ff88",
  "memory-persistence": "#35d6ff",
  "self-evolution": "#ffbd3f",
  "observability": "#35d6ff",
  "kernel-governance": "#39ff88",
  "deployment-substrate": "#ffbd3f",
};

// Edge semantics mapped onto the same three hues (legacy parity).
export const EDGE_COLOR: Readonly<Record<string, string>> = {
  data: "#35d6ff",
  control: "#39ff88",
  persist: "#39ff88",
  learn: "#ffbd3f",
  health: "#35d6ff",
  secret: "#ffbd3f",
};

export const CANVAS_COLOR = Object.freeze({
  accent: "#35d6ff",
  accentGreen: "#39ff88",
  accentAmber: "#ffbd3f",
  ink: "#cbd2dc",
  paper: "#e9edf2",
  paperBright: "#f4f7fa",
  tile: "#22262d",
  tileRaised: "#2a3038",
  tileSide: "#15181d",
  group: "#171a20",
  domainFallback: "#35d6ff",
  boardFallback: "#35d6ff",
  boardNeutral: "#73808f",
  layer: "#35d6ff",
  edgeFallback: "#35d6ff",
  itemFallback: "#8d98a6",
  pedestal: "#171a20",
  migration: "#ffbd3f",
  deprecated: "#ff6b65",
  proposed: "#35d6ff",
  spark: "#35d6ff",
  labelDark: "rgba(13,15,18,.96)",
  labelClear: "rgba(13,15,18,0)",
  labelPaper: "rgba(31,35,42,.96)",
  labelLine: "rgba(53,214,255,.38)",
  labelZone: "rgba(203,210,220,.74)",
  whiteStroke: "rgba(244,247,250,.76)",
  shadow: "rgba(3,5,7,.86)",
  shadowSoft: "rgba(3,5,7,.78)",
  contactShadowCore: "rgba(0,0,0,.58)",
  contactShadowMid: "rgba(0,0,0,.32)",
  contactShadowClear: "rgba(0,0,0,0)",
  keyLight: "rgba(255,255,255,.08)",
  keyLightStrong: "rgba(255,255,255,.1)",
  keyLightClear: "rgba(255,255,255,0)",
  lightFalloff: "rgba(0,0,0,.08)",
  lightFalloffStrong: "rgba(0,0,0,.12)",
  grid: "rgba(255,255,255,.026)",
  selection: "rgba(57,255,136,.96)",
  sparkWash: "rgba(53,214,255,.18)",
  sparkClear: "rgba(53,214,255,0)",
});

// Trust-zone board colors for the Deploy view (legacy HOST_COLOR only
// recolored zones that existed in an older dataset; current zones keep the
// colors authored in the pack builder).
export const HOST_COLOR: Readonly<Record<string, string>> = {
  "clients": "#35d6ff",
  "edge": "#39ff88",
  "k8s": "#35d6ff",
  "nats": "#39ff88",
  "gcp-data": "#ffbd3f",
  "aws": "#ffbd3f",
  "snowflake": "#35d6ff",
  "vendor": "#ffbd3f",
};

export const hexRgb = (hex: string): [number, number, number] => {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
};

export const rgbCss = (r: number, g: number, b: number, a = 1): string =>
  a >= 1
    ? `rgb(${r | 0},${g | 0},${b | 0})`
    : `rgba(${r | 0},${g | 0},${b | 0},${a})`;

// Lighten (f ≥ 0) or darken (f < 0) a hex color, with optional alpha.
export const shade = (hex: string, f: number, a = 1): string => {
  const [r, g, b] = hexRgb(hex);
  if (f >= 0) {
    return rgbCss(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f, a);
  }
  return rgbCss(r * (1 + f), g * (1 + f), b * (1 + f), a);
};

export const domainColor = (node: Pick<ExplorerNode, "domain">): string =>
  DOMAIN_COLOR[node.domain] ?? CANVAS_COLOR.domainFallback;

// FNV-1a-style deterministic [0,1) hash used for particle phase offsets.
export const hash01 = (s: string): number => {
  let h = 2_166_136_261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return ((h >>> 0) % 1000) / 1000;
};
