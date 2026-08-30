import type {
  FormFieldControl,
  FormFieldRole,
  FormSuccessMode,
  FormSubmissionState,
  MonitorCheckErrorType,
  MonitorCheckStatus,
} from "@/generated/prisma/enums";
import type { BrowserViewport } from "@/generated/prisma/enums";

export type FormFieldMapping = {
  role: FormFieldRole;
  control: FormFieldControl;
  selector: string;
  label?: string;
  value?: string;
};

export type FormValidationIssue = {
  code: string;
  message: string;
  selector?: string;
};

export type FormValidationSnapshot = {
  ok: boolean;
  formFound: boolean;
  submitFound: boolean;
  submitVisible: boolean;
  submitEnabled: boolean;
  successConfigured: boolean;
  captchaDetected: boolean;
  passwordDetected: boolean;
  paymentDetected: boolean;
  fileInputDetected: boolean;
  fields: Array<{
    role: FormFieldRole;
    selector: string;
    found: boolean;
    visible: boolean;
    enabled: boolean;
  }>;
  unmappedRequired: string[];
  discovered: {
    forms: number;
    inputs: number;
    buttons: number;
  };
  issues: FormValidationIssue[];
  validatedAt: string;
};

export type FormCheckDetailInput = {
  submissionId: string;
  submissionState: FormSubmissionState;
  successConfirmed: boolean;
  submissionDurationMs: number | null;
  submitHttpStatus: number | null;
  submitEndpointPath: string | null;
  submitMethod: string | null;
  fieldsExpectedCount: number;
  fieldsFoundCount: number;
  formFound: boolean;
  submitClicked: boolean;
  captchaDetected: boolean;
  validationErrors: Array<{ selector: string; message: string }> | null;
  unmappedRequiredFields: string[] | null;
  screenshotBuffer: Buffer | null;
};

export type FormCheckResult = {
  status: MonitorCheckStatus;
  httpStatus: number | null;
  responseTimeMs: number;
  requestedUrl: string;
  finalUrl: string | null;
  redirectCount: number;
  resolvedIp: string | null;
  errorType: MonitorCheckErrorType | null;
  errorMessage: string | null;
  formDetail: FormCheckDetailInput;
};

export type FormMonitorRuntimeConfig = {
  viewport: BrowserViewport;
  formSelector: string;
  submitSelector: string;
  cookieAcceptSelector: string | null;
  fieldMappings: FormFieldMapping[];
  successMode: FormSuccessMode;
  successSelector: string | null;
  successUrlPattern: string | null;
  successText: string | null;
  submissionTimeoutMs: number;
};
