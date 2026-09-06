export type DataManagerEventSource =
  "WEB" | "APP" | "IN_STORE" | "PHONE" | "MESSAGE" | "OTHER";

export type DataManagerAdIdentifiers = {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
};

export type DataManagerDestination = {
  operatingAccount: {
    accountId: string;
    accountType: "GOOGLE_ADS";
  };
  loginAccount?: {
    accountId: string;
    accountType: "GOOGLE_ADS";
  };
  productDestinationId: string;
};

export type DataManagerConversionEvent = {
  transactionId: string;
  eventTimestamp: string;
  eventSource: DataManagerEventSource;
  adIdentifiers: DataManagerAdIdentifiers;
  conversionValue?: number;
  currency?: string;
};

export type IngestConversionInput = {
  destination: DataManagerDestination;
  event: DataManagerConversionEvent;
  validateOnly?: boolean;
};

export type IngestConversionResult = {
  requestId: string;
};

export type DataManagerRequestStatus =
  | "SUCCESS"
  | "FAILED"
  | "PARTIAL_SUCCESS"
  | "PROCESSING"
  | "REQUEST_STATUS_UNKNOWN";

export type DataManagerDiagnostic = {
  reason: string;
  recordCount: number;
};

export type IngestionStatusResult = {
  requestStatus: DataManagerRequestStatus;
  errorReasons: DataManagerDiagnostic[];
  warningReasons: DataManagerDiagnostic[];
  recordCount: number | null;
};

export type ConversionFeedbackProvider = {
  ingestConversion(
    accessToken: string,
    input: IngestConversionInput,
  ): Promise<IngestConversionResult>;
  getIngestionStatus(
    accessToken: string,
    requestId: string,
  ): Promise<IngestionStatusResult>;
};

export type DataManagerTransportError = {
  code: string;
  retryable: boolean;
  httpStatus: number | null;
  authFailure: boolean;
  duplicateTransactionId: boolean;
};
