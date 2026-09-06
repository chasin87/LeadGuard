import {
  googleAdsOAuthScope,
  googleDataManagerOAuthScope,
} from "@/server/google-data-manager/config";

export type GoogleOAuthIntent = "connect" | "data_manager";

export type GoogleConnectionCapabilities = {
  adsRead: boolean;
  dataManager: boolean;
  dataManagerStatus: "NOT_CONFIGURED" | "READY" | "REAUTH_REQUIRED" | "ERROR";
};

export function parseGrantedScopes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function hasScope(scopes: string[], wanted: string): boolean {
  return scopes.includes(wanted);
}

export function requestedScopesForIntent(intent: GoogleOAuthIntent): string[] {
  if (intent === "data_manager") {
    return [googleAdsOAuthScope, googleDataManagerOAuthScope];
  }
  return [googleAdsOAuthScope];
}

export function joinScopes(scopes: string[]): string {
  return scopes.join(" ");
}

export function capabilitiesFromGrantedScopes(
  grantedScopes: string | null | undefined,
  connectionStatus: string,
): GoogleConnectionCapabilities {
  const scopes = parseGrantedScopes(grantedScopes);
  const adsRead =
    hasScope(scopes, googleAdsOAuthScope) ||
    (grantedScopes == null && connectionStatus === "CONNECTED");
  const dataManager = hasScope(scopes, googleDataManagerOAuthScope);
  if (connectionStatus === "ERROR") {
    return { adsRead, dataManager, dataManagerStatus: "ERROR" };
  }
  if (dataManager) {
    return { adsRead, dataManager, dataManagerStatus: "READY" };
  }
  if (adsRead) {
    return {
      adsRead,
      dataManager: false,
      dataManagerStatus:
        grantedScopes == null ? "NOT_CONFIGURED" : "REAUTH_REQUIRED",
    };
  }
  return {
    adsRead: false,
    dataManager: false,
    dataManagerStatus: "REAUTH_REQUIRED",
  };
}

export function dataManagerStatusFromScopes(
  grantedScopes: string | null | undefined,
  connectionStatus: string,
): "NOT_CONFIGURED" | "READY" | "REAUTH_REQUIRED" | "ERROR" {
  return capabilitiesFromGrantedScopes(grantedScopes, connectionStatus)
    .dataManagerStatus;
}
