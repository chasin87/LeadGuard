import type { NotificationErrorType } from "@/generated/prisma/enums";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailSendResult =
  | { ok: true }
  | {
      ok: false;
      retryable: boolean;
      errorType: NotificationErrorType;
      message: string;
    };

export type EmailProvider = {
  readonly kind: "smtp" | "console" | "memory" | "unconfigured";
  send(message: EmailMessage): Promise<EmailSendResult>;
};
