import { describe, expect, it } from "bun:test";
import {
  optionalDeepTrace,
  optionalNewsBrief,
  optionalSkillConfig,
} from "../../../src/runtime/settings-skills";

describe("optionalNewsBrief", () => {
  it("stays off until enabled", () => {
    expect(optionalNewsBrief({}, {})).toEqual({});
  });

  it("applies defaults and optional sources", () => {
    const settings = optionalNewsBrief(
      {
        skills: {
          news_brief: {
            enabled: true,
            keywords: ["ai"],
            alerts: true,
            reddit: { enabled: true },
            guardian: { enabled: true, sections: ["world"] },
            rss: {
              enabled: true,
              feeds: [{ name: "X", url: "https://x/rss" }, { bad: true }],
            },
            newsdata: { enabled: true },
            gnews: { enabled: true, interval_seconds: 120 },
          },
        },
      },
      {
        guardian_api_key: "g",
        newsdata_api_key: "n",
        gnews_api_key: "gn",
      },
    );
    expect(settings.newsBrief?.keywords).toEqual(["ai"]);
    expect(settings.newsBrief?.threshold).toBeCloseTo(0.6);
    expect(settings.newsBrief?.briefSize).toBe(8);
    expect(settings.newsBrief?.alerts).toBe(true);
    expect(settings.newsBrief?.reddit?.multireddit).toContain("worldnews");
    expect(settings.newsBrief?.guardian).toEqual({
      apiKey: "g",
      sections: ["world"],
      intervalSeconds: 600,
    });
    expect(settings.newsBrief?.rss?.feeds).toEqual([
      { name: "X", url: "https://x/rss" },
    ]);
    expect(settings.newsBrief?.newsdata).toEqual({
      apiKey: "n",
      intervalSeconds: 900,
    });
    expect(settings.newsBrief?.gnews).toEqual({
      apiKey: "gn",
      intervalSeconds: 120,
    });
  });

  it("uses default RSS feeds and guardian sections when lists are empty", () => {
    const settings = optionalNewsBrief(
      {
        skills: {
          news_brief: {
            enabled: true,
            guardian: { enabled: true },
            rss: { enabled: true, feeds: [] },
          },
        },
      },
      { guardian_api_key: "g" },
    );
    expect(settings.newsBrief?.guardian?.sections.length).toBeGreaterThan(0);
    expect(settings.newsBrief?.rss?.feeds.length).toBeGreaterThan(0);
  });
});

describe("optionalDeepTrace", () => {
  it("requires enabled plus both address halves", () => {
    expect(optionalDeepTrace({
      skills: { deep_trace: { enabled: true, public_hostname: "h" } },
    })).toEqual({});
    expect(optionalDeepTrace({
      skills: {
        deep_trace: {
          enabled: true,
          public_hostname: "h.example",
          service_url: "http://127.0.0.1:8080",
        },
      },
    })).toEqual({
      deepTrace: {
        publicHostname: "h.example",
        serviceUrl: "http://127.0.0.1:8080",
      },
    });
  });

  it("falls back to deprecated telemetry_map with a warning", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      expect(optionalDeepTrace({
        skills: {
          telemetry_map: {
            enabled: true,
            public_hostname: "legacy.example",
            service_url: "http://127.0.0.1:1",
          },
        },
      })).toEqual({
        deepTrace: {
          publicHostname: "legacy.example",
          serviceUrl: "http://127.0.0.1:1",
        },
      });
      expect(warnings.some((w) => w.includes("telemetry_map"))).toBe(true);
    } finally {
      console.warn = original;
    }
  });
});

describe("optionalSkillConfig", () => {
  it("passes the skills subtree through when it is a record", () => {
    expect(optionalSkillConfig({})).toEqual({});
    expect(optionalSkillConfig({ skills: { custom: { a: 1 } } })).toEqual({
      skillConfig: { custom: { a: 1 } },
    });
  });
});
