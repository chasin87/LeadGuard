export function isGoogleAdsEnabledStatus(
  status: string | null | undefined,
): boolean {
  return (status ?? "").toUpperCase() === "ENABLED";
}

export function isStandardAdSourceActive(input: {
  campaignStatus: string;
  adGroupStatus: string;
  adStatus: string;
}): boolean {
  return (
    isGoogleAdsEnabledStatus(input.campaignStatus) &&
    isGoogleAdsEnabledStatus(input.adGroupStatus) &&
    isGoogleAdsEnabledStatus(input.adStatus)
  );
}

export function isPerformanceMaxSourceActive(input: {
  campaignStatus: string;
  assetGroupStatus: string;
}): boolean {
  return (
    isGoogleAdsEnabledStatus(input.campaignStatus) &&
    isGoogleAdsEnabledStatus(input.assetGroupStatus)
  );
}

export function isObservedSourceActive(campaignStatus: string): boolean {
  return isGoogleAdsEnabledStatus(campaignStatus);
}

export function googleAdsStatusLabel(
  status: string | null | undefined,
): string {
  const value = (status ?? "").toUpperCase();
  if (value === "ENABLED") return "Enabled";
  if (value === "PAUSED") return "Paused";
  if (value === "REMOVED") return "Removed";
  return status || "Unknown";
}
