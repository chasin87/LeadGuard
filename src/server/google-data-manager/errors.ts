import type { DataManagerTransportError } from "@/server/google-data-manager/types";

export class DataManagerProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  readonly authFailure: boolean;
  readonly duplicateTransactionId: boolean;
  readonly acceptedWithoutRequestId: boolean;

  constructor(
    input: DataManagerTransportError & {
      message?: string;
      acceptedWithoutRequestId?: boolean;
    },
  ) {
    super(input.message ?? "Data Manager request failed.");
    this.name = "DataManagerProviderError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.httpStatus = input.httpStatus;
    this.authFailure = input.authFailure;
    this.duplicateTransactionId = input.duplicateTransactionId;
    this.acceptedWithoutRequestId = input.acceptedWithoutRequestId ?? false;
  }
}

export function classifyDataManagerHttpError(
  status: number,
  body: string,
): DataManagerProviderError {
  const lower = body.toLowerCase();
  const authFailure =
    status === 401 ||
    lower.includes("unauthenticated") ||
    lower.includes("invalid_grant") ||
    lower.includes("access denied");
  const duplicate =
    lower.includes("duplicate_transaction_id") ||
    lower.includes("duplicatetransactionid");
  const retryable =
    status === 429 ||
    status >= 500 ||
    lower.includes("resource_exhausted") ||
    lower.includes("unavailable") ||
    lower.includes("deadline_exceeded");
  return new DataManagerProviderError({
    code: authFailure
      ? "AUTH_FAILURE"
      : duplicate
        ? "DUPLICATE_TRANSACTION_ID"
        : retryable
          ? "TRANSIENT"
          : `HTTP_${status}`,
    retryable: retryable && !authFailure && !duplicate,
    httpStatus: status,
    authFailure,
    duplicateTransactionId: duplicate,
  });
}
