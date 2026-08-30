import { describe, expect, it } from "vitest";
import { prepareGoogleAdsDestinationUrl } from "@/server/google-ads/urls";

describe("Google Ads destination URLs", () => {
  it("keeps query params and normalizes the host", () => {
    const prepared = prepareGoogleAdsDestinationUrl(
      "https://Example.nl/airco?variant=a",
      "FINAL_URL",
    );
    expect(prepared.kind).toBe("monitorable");
    if (prepared.kind === "monitorable") {
      expect(prepared.normalizedUrl).toBe("https://example.nl/airco?variant=a");
      expect(prepared.origin).toBe("https://example.nl");
    }
  });

  it("does not invent values for unresolved macros", () => {
    const prepared = prepareGoogleAdsDestinationUrl(
      "https://example.nl/{_landing}",
      "FINAL_URL",
    );
    expect(prepared).toMatchObject({
      kind: "unsupported",
      approvalStatus: "UNSUPPORTED",
      reason: "unresolved_template",
    });
  });

  it("treats query-only macros as unresolved rather than guessing", () => {
    const prepared = prepareGoogleAdsDestinationUrl(
      "https://example.nl/landing?campaign={campaignid}",
      "FINAL_URL",
    );
    expect(prepared.kind).toBe("unsupported");
  });

  it("blocks private IP destinations", () => {
    const prepared = prepareGoogleAdsDestinationUrl(
      "http://169.254.169.254/latest/meta-data",
      "FINAL_URL",
    );
    expect(prepared.kind).toBe("blocked");
  });

  it("skips non-http schemes", () => {
    expect(
      prepareGoogleAdsDestinationUrl("mailto:ads@example.nl", "FINAL_URL").kind,
    ).toBe("unsupported");
    expect(
      prepareGoogleAdsDestinationUrl("tel:+31201234567", "FINAL_URL").kind,
    ).toBe("unsupported");
  });
});
