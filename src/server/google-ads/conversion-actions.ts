export type GoogleAdsConversionAction = {
  conversionActionId: string;
  name: string;
  status: string;
  type: string;
  category: string | null;
  countingType: string | null;
  clickThroughLookbackWindowDays: number | null;
};

export function isSuitableOfflineConversionAction(
  action: Pick<GoogleAdsConversionAction, "status" | "type">,
): boolean {
  return action.status === "ENABLED" && action.type === "UPLOAD_CLICKS";
}

export function identifierTypesLabel(input: {
  hasGclid: boolean;
  hasGbraid: boolean;
  hasWbraid: boolean;
}): string {
  const parts: string[] = [];
  if (input.hasGclid) parts.push("GCLID");
  if (input.hasGbraid) parts.push("GBRAID");
  if (input.hasWbraid) parts.push("WBRAID");
  return parts.join(",");
}
