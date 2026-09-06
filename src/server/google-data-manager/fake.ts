import { randomBytes } from "node:crypto";
import { googleDataManagerBaseUrl } from "@/server/google-data-manager/config";
import { DataManagerProviderError } from "@/server/google-data-manager/errors";
import type {
  ConversionFeedbackProvider,
  IngestConversionInput,
  IngestConversionResult,
  IngestionStatusResult,
  DataManagerRequestStatus,
} from "@/server/google-data-manager/types";

export type FakeDataManagerMode =
  | "SUCCESS"
  | "PROCESSING_THEN_SUCCESS"
  | "FAILED"
  | "PARTIAL_SUCCESS"
  | "INVALID_GCLID"
  | "TOO_RECENT_CLICK"
  | "EVENT_TOO_OLD"
  | "ACCOUNT_MISMATCH"
  | "DUPLICATE_TRANSACTION_ID"
  | "NETWORK_BEFORE_REQUEST_ID"
  | "NETWORK_AFTER_ACCEPT"
  | "REAUTH_REQUIRED"
  | "CLICK_NOT_FOUND"
  | "CONSENT_DENIED";

type StoredIngest = {
  requestId: string;
  input: IngestConversionInput;
  polls: number;
  failedNetworkAfterAccept: boolean;
};

export type FakeDataManagerWorld = {
  mode: FakeDataManagerMode;
  ingested: StoredIngest[];
  statusPolls: number;
  revoked: boolean;
};

const defaultWorld = (): FakeDataManagerWorld => ({
  mode: "PROCESSING_THEN_SUCCESS",
  ingested: [],
  statusPolls: 0,
  revoked: false,
});

let world = defaultWorld();

export function resetFakeDataManagerWorld(
  patch: Partial<FakeDataManagerWorld> = {},
): FakeDataManagerWorld {
  world = { ...defaultWorld(), ...patch };
  return world;
}

export function getFakeDataManagerWorld(): FakeDataManagerWorld {
  return world;
}

function assertNotRevoked() {
  if (world.revoked || world.mode === "REAUTH_REQUIRED") {
    throw new DataManagerProviderError({
      code: "AUTH_FAILURE",
      retryable: false,
      httpStatus: 401,
      authFailure: true,
      duplicateTransactionId: false,
    });
  }
}

function requestIdFor(transactionId: string): string {
  const existing = world.ingested.find(
    (row) => row.input.event.transactionId === transactionId,
  );
  if (existing) return existing.requestId;
  return `dmreq_${randomBytes(8).toString("hex")}`;
}

export function createFakeGoogleConversionFeedbackProvider(): ConversionFeedbackProvider {
  return {
    async ingestConversion(
      _accessToken: string,
      input: IngestConversionInput,
    ): Promise<IngestConversionResult> {
      assertNotRevoked();
      if (input.validateOnly) {
        return { requestId: `validate_${randomBytes(4).toString("hex")}` };
      }
      if (
        world.mode === "NETWORK_BEFORE_REQUEST_ID" ||
        world.mode === "NETWORK_AFTER_ACCEPT"
      ) {
        const already = world.ingested.find(
          (row) => row.input.event.transactionId === input.event.transactionId,
        );
        if (!already) {
          const requestId = requestIdFor(input.event.transactionId);
          world.ingested.push({
            requestId,
            input,
            polls: 0,
            failedNetworkAfterAccept: true,
          });
          throw new DataManagerProviderError({
            code: "NETWORK",
            retryable: true,
            httpStatus: null,
            authFailure: false,
            duplicateTransactionId: false,
            acceptedWithoutRequestId: true,
          });
        }
        already.failedNetworkAfterAccept = false;
        already.input = input;
        return { requestId: already.requestId };
      }
      const duplicate = world.ingested.find(
        (row) =>
          row.input.event.transactionId === input.event.transactionId &&
          !row.failedNetworkAfterAccept,
      );
      if (duplicate || world.mode === "DUPLICATE_TRANSACTION_ID") {
        if (duplicate && world.mode !== "DUPLICATE_TRANSACTION_ID") {
          throw new DataManagerProviderError({
            code: "DUPLICATE_TRANSACTION_ID",
            retryable: false,
            httpStatus: 409,
            authFailure: false,
            duplicateTransactionId: true,
          });
        }
        if (world.mode === "DUPLICATE_TRANSACTION_ID") {
          throw new DataManagerProviderError({
            code: "DUPLICATE_TRANSACTION_ID",
            retryable: false,
            httpStatus: 409,
            authFailure: false,
            duplicateTransactionId: true,
          });
        }
      }
      const requestId = requestIdFor(input.event.transactionId);
      const existingAmbiguous = world.ingested.find(
        (row) => row.input.event.transactionId === input.event.transactionId,
      );
      if (existingAmbiguous) {
        existingAmbiguous.failedNetworkAfterAccept = false;
        existingAmbiguous.input = input;
      } else {
        world.ingested.push({
          requestId,
          input,
          polls: 0,
          failedNetworkAfterAccept: false,
        });
      }
      return { requestId };
    },

    async getIngestionStatus(
      _accessToken: string,
      requestId: string,
    ): Promise<IngestionStatusResult> {
      assertNotRevoked();
      world.statusPolls += 1;
      const stored = world.ingested.find((row) => row.requestId === requestId);
      if (stored) stored.polls += 1;
      const polls = stored?.polls ?? world.statusPolls;
      const failed = (
        status: DataManagerRequestStatus,
        reason: string,
      ): IngestionStatusResult => ({
        requestStatus: status,
        errorReasons: [{ reason, recordCount: 1 }],
        warningReasons: [],
        recordCount: 1,
      });
      switch (world.mode) {
        case "SUCCESS":
          return {
            requestStatus: "SUCCESS",
            errorReasons: [],
            warningReasons: [],
            recordCount: 1,
          };
        case "PROCESSING_THEN_SUCCESS":
        case "NETWORK_BEFORE_REQUEST_ID":
        case "NETWORK_AFTER_ACCEPT":
          if (polls < 2) {
            return {
              requestStatus: "PROCESSING",
              errorReasons: [],
              warningReasons: [],
              recordCount: null,
            };
          }
          return {
            requestStatus: "SUCCESS",
            errorReasons: [],
            warningReasons: [],
            recordCount: 1,
          };
        case "FAILED":
          return failed("FAILED", "PROCESSING_ERROR_REASON_INVALID_EVENT");
        case "PARTIAL_SUCCESS":
          return failed(
            "PARTIAL_SUCCESS",
            "PROCESSING_ERROR_REASON_INVALID_EVENT",
          );
        case "INVALID_GCLID":
          return failed("FAILED", "PROCESSING_ERROR_REASON_INVALID_GCLID");
        case "TOO_RECENT_CLICK":
          return failed("FAILED", "PROCESSING_ERROR_REASON_TOO_RECENT_CLICK");
        case "EVENT_TOO_OLD":
          return failed("FAILED", "PROCESSING_ERROR_REASON_EVENT_TOO_OLD");
        case "ACCOUNT_MISMATCH":
          return failed(
            "FAILED",
            "PROCESSING_ERROR_OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER",
          );
        case "CLICK_NOT_FOUND":
          return failed("FAILED", "PROCESSING_ERROR_REASON_CLICK_NOT_FOUND");
        case "CONSENT_DENIED":
          return failed("FAILED", "PROCESSING_ERROR_REASON_DENIED_CONSENT");
        case "DUPLICATE_TRANSACTION_ID":
          return failed(
            "FAILED",
            "PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID",
          );
        default:
          return {
            requestStatus: "REQUEST_STATUS_UNKNOWN",
            errorReasons: [],
            warningReasons: [],
            recordCount: null,
          };
      }
    },
  };
}

export function fakeDataManagerIngestUrl(): string {
  return `${googleDataManagerBaseUrl}/events:ingest`;
}
