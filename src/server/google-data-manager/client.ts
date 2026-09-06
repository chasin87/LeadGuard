import { googleDataManagerBaseUrl } from "@/server/google-data-manager/config";
import {
  classifyDataManagerHttpError,
  DataManagerProviderError,
} from "@/server/google-data-manager/errors";
import type {
  ConversionFeedbackProvider,
  DataManagerRequestStatus,
  IngestConversionInput,
  IngestConversionResult,
  IngestionStatusResult,
} from "@/server/google-data-manager/types";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

async function dataManagerFetch(
  url: string,
  accessToken: string,
  init: RequestInit,
): Promise<{ json: JsonObject; status: number }> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new DataManagerProviderError({
      code: "NETWORK",
      retryable: true,
      httpStatus: null,
      authFailure: false,
      duplicateTransactionId: false,
    });
  }
  const text = await response.text();
  if (!response.ok) {
    throw classifyDataManagerHttpError(response.status, text);
  }
  if (!text) return { json: {}, status: response.status };
  try {
    return { json: JSON.parse(text) as JsonObject, status: response.status };
  } catch {
    throw new DataManagerProviderError({
      code: "INVALID_RESPONSE",
      retryable: true,
      httpStatus: response.status,
      authFailure: false,
      duplicateTransactionId: false,
    });
  }
}

function ingestBody(input: IngestConversionInput) {
  const destination: JsonObject = {
    operatingAccount: {
      accountId: input.destination.operatingAccount.accountId,
      accountType: input.destination.operatingAccount.accountType,
    },
    productDestinationId: input.destination.productDestinationId,
  };
  if (input.destination.loginAccount) {
    destination.loginAccount = {
      accountId: input.destination.loginAccount.accountId,
      accountType: input.destination.loginAccount.accountType,
    };
  }
  const event: JsonObject = {
    transactionId: input.event.transactionId,
    eventTimestamp: input.event.eventTimestamp,
    eventSource: input.event.eventSource,
    adIdentifiers: input.event.adIdentifiers,
  };
  if (input.event.conversionValue !== undefined) {
    event.conversionValue = input.event.conversionValue;
    event.currency = input.event.currency;
  }
  return {
    destinations: [destination],
    events: [event],
    validateOnly: input.validateOnly === true,
  };
}

const requestStatuses = new Set<DataManagerRequestStatus>([
  "SUCCESS",
  "FAILED",
  "PARTIAL_SUCCESS",
  "PROCESSING",
  "REQUEST_STATUS_UNKNOWN",
]);

function parseStatus(value: unknown): DataManagerRequestStatus {
  return requestStatuses.has(value as DataManagerRequestStatus)
    ? (value as DataManagerRequestStatus)
    : "REQUEST_STATUS_UNKNOWN";
}

export function createLiveGoogleConversionFeedbackProvider(): ConversionFeedbackProvider {
  return {
    async ingestConversion(
      accessToken: string,
      input: IngestConversionInput,
    ): Promise<IngestConversionResult> {
      const { json } = await dataManagerFetch(
        `${googleDataManagerBaseUrl}/events:ingest`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify(ingestBody(input)),
        },
      );
      const requestId = asString(json.requestId);
      if (!requestId) {
        throw new DataManagerProviderError({
          code: "MISSING_REQUEST_ID",
          retryable: true,
          httpStatus: 200,
          authFailure: false,
          duplicateTransactionId: false,
          acceptedWithoutRequestId: true,
        });
      }
      return { requestId };
    },

    async getIngestionStatus(
      accessToken: string,
      requestId: string,
    ): Promise<IngestionStatusResult> {
      const url = new URL(`${googleDataManagerBaseUrl}/requestStatus:retrieve`);
      url.searchParams.set("requestId", requestId);
      const { json } = await dataManagerFetch(url.toString(), accessToken, {
        method: "GET",
      });
      const perDestination = Array.isArray(json.requestStatusPerDestination)
        ? json.requestStatusPerDestination
        : [];
      const first = asObject(perDestination[0]);
      const eventsStatus = asObject(first.eventsIngestionStatus);
      const errorInfo = asObject(first.errorInfo);
      const warningInfo = asObject(first.warningInfo);
      const errorCounts = Array.isArray(errorInfo.errorCounts)
        ? errorInfo.errorCounts
        : [];
      const warningCounts = Array.isArray(warningInfo.warningCounts)
        ? warningInfo.warningCounts
        : [];
      return {
        requestStatus: parseStatus(first.requestStatus),
        errorReasons: errorCounts.map((row) => {
          const item = asObject(row);
          return {
            reason: asString(item.reason),
            recordCount: asNumber(item.recordCount) ?? 0,
          };
        }),
        warningReasons: warningCounts.map((row) => {
          const item = asObject(row);
          return {
            reason: asString(item.reason),
            recordCount: asNumber(item.recordCount) ?? 0,
          };
        }),
        recordCount: asNumber(eventsStatus.recordCount),
      };
    },
  };
}
