import { describe, expect, it } from "vitest";
import { originsMatchWebsite, corsHeaders } from "@/server/tracking/origin";

describe("tracking origin validation", () => {
  it("accepts the website origin and a www sibling", () => {
    expect(
      originsMatchWebsite({
        requestOrigin: "https://example.nl",
        websiteOrigin: "https://example.nl",
      }),
    ).toBe(true);
    expect(
      originsMatchWebsite({
        requestOrigin: "https://www.example.nl",
        websiteOrigin: "https://example.nl",
      }),
    ).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(
      originsMatchWebsite({
        requestOrigin: "https://evil.example",
        websiteOrigin: "https://example.nl",
      }),
    ).toBe(false);
    expect(
      originsMatchWebsite({
        requestOrigin: "https://offerte.example.nl",
        websiteOrigin: "https://example.nl",
      }),
    ).toBe(false);
  });

  it("emits CORS headers for a reflected origin", () => {
    expect(
      corsHeaders("https://example.nl")["Access-Control-Allow-Origin"],
    ).toBe("https://example.nl");
  });
});
