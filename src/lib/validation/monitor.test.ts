import { describe, expect, it } from "vitest";
import { createMonitorSchema } from "./monitor";

describe("monitor validation", () => {
  it("defaults to an HTTP monitor", () => {
    const parsed = createMonitorSchema.safeParse({
      name: "Homepage",
      url: "https://example.com/",
      intervalSeconds: "300",
      timeoutMs: "10000",
      consecutiveFailuresBeforeIncident: "2",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("HTTP");
    }
  });

  it("accepts a browser monitor with viewport and selector", () => {
    const parsed = createMonitorSchema.safeParse({
      type: "BROWSER",
      name: "Homepage render",
      url: "https://example.com/",
      intervalSeconds: "600",
      timeoutMs: "20000",
      consecutiveFailuresBeforeIncident: "2",
      viewport: "MOBILE",
      requiredSelector: "#quote-cta",
      requiredElementName: "Quote request",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "BROWSER") {
      expect(parsed.data.viewport).toBe("MOBILE");
      expect(parsed.data.requiredSelector).toBe("#quote-cta");
    }
  });

  it("rejects an invalid CSS selector", () => {
    const parsed = createMonitorSchema.safeParse({
      type: "BROWSER",
      name: "Broken",
      url: "https://example.com/",
      intervalSeconds: "600",
      timeoutMs: "20000",
      consecutiveFailuresBeforeIncident: "2",
      viewport: "DESKTOP",
      requiredSelector: "div[",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a raw HTML attribute as a selector", () => {
    const parsed = createMonitorSchema.safeParse({
      type: "BROWSER",
      name: "Broken",
      url: "https://example.com/",
      intervalSeconds: "600",
      timeoutMs: "20000",
      consecutiveFailuresBeforeIncident: "2",
      viewport: "DESKTOP",
      requiredSelector: 'data-slot="button"',
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a 5-minute interval for browser monitors", () => {
    const parsed = createMonitorSchema.safeParse({
      type: "BROWSER",
      name: "Too often",
      url: "https://example.com/",
      intervalSeconds: "300",
      timeoutMs: "20000",
      consecutiveFailuresBeforeIncident: "2",
      viewport: "DESKTOP",
    });
    expect(parsed.success).toBe(false);
  });
});
