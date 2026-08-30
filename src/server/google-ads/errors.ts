export class GoogleAdsProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly providerRequestId: string | null;
  readonly authFailure: boolean;
  readonly accessLost: boolean;
  readonly platformConfig: boolean;

  constructor(input: {
    code: string;
    message: string;
    retryable?: boolean;
    providerRequestId?: string | null;
    authFailure?: boolean;
    accessLost?: boolean;
    platformConfig?: boolean;
  }) {
    super(input.message);
    this.name = "GoogleAdsProviderError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.providerRequestId = input.providerRequestId ?? null;
    this.authFailure = input.authFailure ?? false;
    this.accessLost = input.accessLost ?? false;
    this.platformConfig = input.platformConfig ?? false;
  }
}

export const googleAdsUserErrors = {
  reauthRequired: "Google Ads access expired. Reconnect your account.",
  accessLost: "LeadGuard no longer has access to this Google Ads account.",
  missingOfflineAccess:
    "Google did not grant offline access. Reconnect and approve access.",
  platformConfig: "Google Ads is not configured on this LeadGuard environment.",
  syncInProgress: "A sync is already running for this account.",
  syncCooldown: "Wait a minute before running another sync.",
  notConnected: "Connect Google Ads before continuing.",
  managerNotSelectable:
    "Manager accounts cannot be monitored. Select advertiser accounts.",
  accountNotAccessible:
    "That Google Ads account is not available for this connection.",
  impactCooldown: "Wait a minute before refreshing impact again.",
  impactNotFound: "Google Ads impact is not available for this incident.",
} as const;

export function userFacingGoogleAdsError(error: unknown): string {
  if (error instanceof GoogleAdsProviderError) {
    if (error.authFailure) return googleAdsUserErrors.reauthRequired;
    if (error.accessLost) return googleAdsUserErrors.accessLost;
    if (error.platformConfig) return googleAdsUserErrors.platformConfig;
  }
  if (error instanceof Error && error.message in googleAdsUserErrors) {
    return error.message;
  }
  return "Google Ads could not complete this request. Try again later.";
}
