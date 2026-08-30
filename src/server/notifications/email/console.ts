import type {
  EmailMessage,
  EmailProvider,
  EmailSendResult,
} from "@/server/notifications/email/types";
import { maskEmailAddress } from "@/server/notifications/privacy";
import { createLogger } from "@/server/logger";

const logger = createLogger("notifications");

export function createConsoleEmailProvider(): EmailProvider {
  return {
    kind: "console",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      logger.info("notification.email.console", {
        to: maskEmailAddress(message.to),
        subject: message.subject,
      });
      return { ok: true };
    },
  };
}
