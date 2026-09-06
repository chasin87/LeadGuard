import { getGoogleAdsAuthClient } from "@/server/google-ads/clients";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import { decryptSecret } from "@/server/google-ads/encryption";
import { DomainError } from "@/server/authorization/errors";
import { googleAdsUserErrors } from "@/server/google-ads/errors";

export async function refreshGoogleConnectionAccessToken(connection: {
  encryptedRefreshToken: string | null;
}): Promise<string> {
  const config = getGoogleAdsConfig();
  if (!connection.encryptedRefreshToken) {
    throw new DomainError(googleAdsUserErrors.reauthRequired);
  }
  const refreshToken = decryptSecret(connection.encryptedRefreshToken);
  const refreshed = await getGoogleAdsAuthClient().refreshAccessToken({
    refreshToken,
    clientId: config.clientId || "fake-client-id",
    clientSecret: config.clientSecret || "fake-client-secret",
  });
  return refreshed.accessToken;
}
