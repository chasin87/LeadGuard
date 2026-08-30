import { parseHttpUrlInput } from "@/lib/urls/normalize-url";
import { UrlValidationError } from "@/server/security/errors";
import {
  isBlockedIpAddress,
  isLiteralIpHostname,
} from "@/server/security/ip-classification";
import type {
  GoogleAdsDestinationApprovalStatus,
  GoogleAdsDestinationUrlType,
} from "@/generated/prisma/enums";

const urlTemplatePattern = /\{[_a-zA-Z][a-zA-Z0-9.]*\}/;
const allowedSchemes = new Set(["http:", "https:"]);

export type PreparedDestinationUrl =
  | {
      kind: "monitorable";
      sourceUrl: string;
      monitoringUrl: string;
      normalizedUrl: string;
      origin: string;
      hostname: string;
      urlType: GoogleAdsDestinationUrlType;
      approvalStatus: Extract<
        GoogleAdsDestinationApprovalStatus,
        "NEEDS_APPROVAL" | "APPROVED"
      >;
    }
  | {
      kind: "unsupported";
      sourceUrl: string;
      urlType: GoogleAdsDestinationUrlType;
      approvalStatus: "UNSUPPORTED";
      reason: "unresolved_template" | "unsupported_scheme" | "invalid_url";
    }
  | {
      kind: "blocked";
      sourceUrl: string;
      urlType: GoogleAdsDestinationUrlType;
      approvalStatus: "BLOCKED";
      reason: "private_target" | "internal_hostname";
    };

export function containsUrlTemplate(value: string): boolean {
  return urlTemplatePattern.test(value);
}

export function prepareGoogleAdsDestinationUrl(
  sourceUrl: string,
  urlType: GoogleAdsDestinationUrlType,
): PreparedDestinationUrl {
  const trimmed = sourceUrl.trim();
  if (!trimmed) {
    return {
      kind: "unsupported",
      sourceUrl,
      urlType,
      approvalStatus: "UNSUPPORTED",
      reason: "invalid_url",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      kind: "unsupported",
      sourceUrl,
      urlType,
      approvalStatus: "UNSUPPORTED",
      reason: "invalid_url",
    };
  }

  if (!allowedSchemes.has(parsed.protocol)) {
    return {
      kind: "unsupported",
      sourceUrl,
      urlType,
      approvalStatus: "UNSUPPORTED",
      reason: "unsupported_scheme",
    };
  }

  if (containsUrlTemplate(trimmed)) {
    return {
      kind: "unsupported",
      sourceUrl,
      urlType,
      approvalStatus: "UNSUPPORTED",
      reason: "unresolved_template",
    };
  }

  if (
    isLiteralIpHostname(parsed.hostname) &&
    isBlockedIpAddress(parsed.hostname)
  ) {
    return {
      kind: "blocked",
      sourceUrl,
      urlType,
      approvalStatus: "BLOCKED",
      reason: "private_target",
    };
  }

  try {
    const normalized = parseHttpUrlInput(trimmed);
    return {
      kind: "monitorable",
      sourceUrl,
      monitoringUrl: normalized.normalizedUrl,
      normalizedUrl: normalized.normalizedUrl,
      origin: normalized.origin,
      hostname: normalized.hostname,
      urlType,
      approvalStatus: "NEEDS_APPROVAL",
    };
  } catch (error) {
    if (error instanceof UrlValidationError) {
      if (
        error.reason === "private_target" ||
        error.reason === "internal_hostname"
      ) {
        return {
          kind: "blocked",
          sourceUrl,
          urlType,
          approvalStatus: "BLOCKED",
          reason: error.reason,
        };
      }
    }
    return {
      kind: "unsupported",
      sourceUrl,
      urlType,
      approvalStatus: "UNSUPPORTED",
      reason: "invalid_url",
    };
  }
}
