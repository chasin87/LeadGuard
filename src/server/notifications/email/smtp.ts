import type { NotificationErrorType } from "@/generated/prisma/enums";
import type {
  EmailMessage,
  EmailProvider,
  EmailSendResult,
} from "@/server/notifications/email/types";
import { getServerEnvironment } from "@/lib/env";
import { sanitizePublicErrorMessage } from "@/server/notifications/privacy";

function classifySmtpError(error: unknown): {
  retryable: boolean;
  errorType: NotificationErrorType;
  message: string;
} {
  const err = error as {
    code?: string;
    responseCode?: number;
    command?: string;
    message?: string;
  };
  const code = err.code ?? "";
  const responseCode = err.responseCode;
  const message = sanitizePublicErrorMessage(err.message ?? "SMTP error");

  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === "ETIME" ||
    message.toLowerCase().includes("timeout")
  ) {
    return { retryable: true, errorType: "TIMEOUT", message: "SMTP timeout" };
  }
  if (
    code === "ECONNECTION" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH"
  ) {
    return {
      retryable: true,
      errorType: "CONNECTION_ERROR",
      message: "Could not connect to the mail server.",
    };
  }
  if (code === "EAUTH" || responseCode === 535) {
    return {
      retryable: false,
      errorType: "AUTH_ERROR",
      message: "Mail server authentication failed.",
    };
  }
  if (
    responseCode === 421 ||
    responseCode === 450 ||
    responseCode === 451 ||
    responseCode === 452
  ) {
    return {
      retryable: true,
      errorType: "PROVIDER_ERROR",
      message: "Mail server asked to try again later.",
    };
  }
  if (responseCode === 550 || responseCode === 551 || responseCode === 553) {
    return {
      retryable: false,
      errorType: "RECIPIENT_REJECTED",
      message: "The recipient address was rejected.",
    };
  }
  if (typeof responseCode === "number" && responseCode >= 500) {
    return {
      retryable: false,
      errorType: "PROVIDER_ERROR",
      message: "The mail server rejected the message.",
    };
  }
  return { retryable: true, errorType: "UNKNOWN", message };
}

export function createUnconfiguredEmailProvider(): EmailProvider {
  return {
    kind: "unconfigured",
    async send(): Promise<EmailSendResult> {
      return {
        ok: false,
        retryable: false,
        errorType: "PROVIDER_ERROR",
        message: "Email delivery is not configured.",
      };
    },
  };
}

export async function createSmtpEmailProvider(): Promise<EmailProvider> {
  const env = getServerEnvironment();
  if (!env.SMTP_HOST || !env.EMAIL_FROM) {
    return createUnconfiguredEmailProvider();
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? (env.SMTP_SECURE === "true" ? 465 : 587),
    secure: env.SMTP_SECURE === "true",
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 10_000,
    greetingTimeout: 10_000,
  });

  return {
    kind: "smtp",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const reservedExample =
        process.env.NODE_ENV !== "production" &&
        /@(example\.com|example\.org|example\.net)$/i.test(message.to);
      if (reservedExample) {
        return { ok: true };
      }
      try {
        await transporter.sendMail({
          from: env.EMAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        return { ok: true };
      } catch (error) {
        const classified = classifySmtpError(error);
        return { ok: false, ...classified };
      }
    },
  };
}
