import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  assertFakeProviderNotUsedInProduction,
  getGoogleAdsConfig,
} from "@/server/google-ads/config";
import { GoogleAdsProviderError } from "@/server/google-ads/errors";
import {
  createFakeGoogleAdsAuthClient,
  createFakeGoogleAdsReadProvider,
} from "@/server/google-ads/fake-provider";
import {
  createLiveGoogleAdsAuthClient,
  createLiveGoogleAdsReadProvider,
} from "@/server/google-ads/live-provider";
import type {
  GoogleAdsAuthClient,
  GoogleAdsReadProvider,
} from "@/server/google-ads/provider";

export function getGoogleAdsReadProvider(): GoogleAdsReadProvider {
  assertFakeProviderNotUsedInProduction();
  return getGoogleAdsConfig().provider === "fake"
    ? createFakeGoogleAdsReadProvider()
    : createLiveGoogleAdsReadProvider();
}

export function getGoogleAdsAuthClient(): GoogleAdsAuthClient {
  assertFakeProviderNotUsedInProduction();
  return getGoogleAdsConfig().provider === "fake"
    ? createFakeGoogleAdsAuthClient()
    : createLiveGoogleAdsAuthClient();
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function generateOAuthState(): string {
  return randomBytes(32).toString("hex");
}

export function timingSafeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function mapProviderFailure(error: unknown): GoogleAdsProviderError {
  if (error instanceof GoogleAdsProviderError) return error;
  if (error instanceof Error) {
    if (
      error.name === "GoogleAdsAuthError" ||
      error.message === "invalid_grant"
    ) {
      return new GoogleAdsProviderError({
        code: "AUTH_FAILURE",
        message: "Google Ads request failed.",
        authFailure: true,
      });
    }
    if (error.name === "GoogleAdsAccessLostError") {
      return new GoogleAdsProviderError({
        code: "ACCESS_LOST",
        message: "Google Ads request failed.",
        accessLost: true,
      });
    }
    if (error.message === "GOOGLE_ADS_UNAVAILABLE") {
      return new GoogleAdsProviderError({
        code: "TRANSIENT",
        message: "Google Ads request failed.",
        retryable: true,
      });
    }
    if (error.message === "GOOGLE_ADS_FAKE_PARTIAL") {
      return new GoogleAdsProviderError({
        code: "TRANSIENT",
        message: "Google Ads request failed.",
        retryable: true,
      });
    }
  }
  return new GoogleAdsProviderError({
    code: "UNKNOWN",
    message: "Google Ads request failed.",
    retryable: true,
  });
}
