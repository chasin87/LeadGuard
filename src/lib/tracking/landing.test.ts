import { describe, expect, it } from "vitest";
import {
  parseUtmFromUnknown,
  sanitizeLandingUrl,
  sanitizeReferrerDomain,
} from "@/lib/tracking/landing";

describe("landing sanitization", () => {
  it("keeps origin and path and drops query parameters", () => {
    expect(
      sanitizeLandingUrl(
        "https://site.nl/airco?email=a@b.com&gclid=abc&utm_source=google",
      ),
    ).toEqual({ origin: "https://site.nl", pathname: "/airco" });
  });

  it("stores referrer domain only", () => {
    expect(
      sanitizeReferrerDomain("https://google.com/search?q=secret@email.com"),
    ).toBe("google.com");
  });

  it("bounds utm parameters and ignores other keys", () => {
    const utm = parseUtmFromUnknown({
      utm_source: "google",
      utm_medium: "cpc",
      extra: "drop-me",
    });
    expect(utm.utmSource).toBe("google");
    expect(utm.utmMedium).toBe("cpc");
    expect(Object.keys(utm)).toEqual([
      "utmSource",
      "utmMedium",
      "utmCampaign",
      "utmContent",
      "utmTerm",
    ]);
  });
});
