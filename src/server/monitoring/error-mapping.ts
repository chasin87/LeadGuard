import type { MonitorCheckErrorType } from "@/generated/prisma/enums";
import { UrlValidationError } from "@/server/security/errors";

export type MappedNetworkError = {
  errorType: MonitorCheckErrorType;
  errorMessage: string;
};

function codeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function mapNetworkError(error: unknown): MappedNetworkError {
  const code = codeOf(error);
  const message = messageOf(error).toLowerCase();

  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "EAI_FAIL" ||
    code === "EAI_NODATA" ||
    code === "EAI_NONAME"
  ) {
    return { errorType: "DNS_ERROR", errorMessage: "DNS lookup failed." };
  }

  if (
    code === "CERT_HAS_EXPIRED" ||
    code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "ERR_TLS_CERT_REVOKED" ||
    message.includes("certificate") ||
    message.includes("ssl") ||
    message.includes("tls")
  ) {
    return {
      errorType: "SSL_ERROR",
      errorMessage: "SSL certificate error.",
    };
  }

  if (
    code === "ABORT_ERR" ||
    code === "ETIMEDOUT" ||
    message.includes("timeout")
  ) {
    return { errorType: "TIMEOUT", errorMessage: "The request timed out." };
  }

  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH" ||
    code === "EPIPE" ||
    code === "ECONNABORTED"
  ) {
    return {
      errorType: "CONNECTION_ERROR",
      errorMessage: "Connection failed.",
    };
  }

  return {
    errorType: "UNKNOWN",
    errorMessage: "The check could not be completed.",
  };
}

export function mapUrlValidationError(
  error: UrlValidationError,
  kind: "target" | "redirect",
): MappedNetworkError {
  if (error.reason === "dns_failed") {
    return { errorType: "DNS_ERROR", errorMessage: "DNS lookup failed." };
  }
  if (kind === "redirect") {
    return {
      errorType: "UNSAFE_REDIRECT",
      errorMessage:
        "A redirect pointed to an address that cannot be monitored.",
    };
  }
  return {
    errorType: "UNSAFE_TARGET",
    errorMessage: "Private and internal network addresses cannot be monitored.",
  };
}
