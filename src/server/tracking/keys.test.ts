import { describe, expect, it } from "vitest";
import {
  generateAttributionToken,
  generatePublicSiteKey,
  generateServerIngestionSecret,
  hashTrackingSecret,
  isAttributionToken,
  isPublicSiteKey,
  isServerIngestionSecret,
} from "@/server/tracking/keys";

describe("tracking keys", () => {
  it("generates unpredictable public site keys and hashed secrets", () => {
    const siteKey = generatePublicSiteKey();
    const secret = generateServerIngestionSecret();
    const token = generateAttributionToken();
    expect(isPublicSiteKey(siteKey)).toBe(true);
    expect(isServerIngestionSecret(secret)).toBe(true);
    expect(isAttributionToken(token)).toBe(true);
    expect(siteKey).not.toBe(generatePublicSiteKey());
    expect(hashTrackingSecret(secret)).not.toBe(secret);
    expect(hashTrackingSecret(secret)).toHaveLength(64);
  });
});
