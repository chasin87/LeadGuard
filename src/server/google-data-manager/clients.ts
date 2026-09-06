import { assertFakeDataManagerNotUsedInProduction } from "@/server/google-data-manager/config";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import { createFakeGoogleConversionFeedbackProvider } from "@/server/google-data-manager/fake";
import { createLiveGoogleConversionFeedbackProvider } from "@/server/google-data-manager/client";
import type { ConversionFeedbackProvider } from "@/server/google-data-manager/types";

export function getGoogleConversionFeedbackProvider(): ConversionFeedbackProvider {
  assertFakeDataManagerNotUsedInProduction();
  return getGoogleAdsConfig().provider === "fake"
    ? createFakeGoogleConversionFeedbackProvider()
    : createLiveGoogleConversionFeedbackProvider();
}
