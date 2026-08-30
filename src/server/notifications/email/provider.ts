import type { EmailProvider } from "@/server/notifications/email/types";
import { createConsoleEmailProvider } from "@/server/notifications/email/console";
import { createMemoryEmailProvider } from "@/server/notifications/email/memory";
import {
  createSmtpEmailProvider,
  createUnconfiguredEmailProvider,
} from "@/server/notifications/email/smtp";
import { getServerEnvironment } from "@/lib/env";

let override: EmailProvider | undefined;
let cached: Promise<EmailProvider> | undefined;

export function setEmailProviderOverride(provider: EmailProvider | undefined) {
  override = provider;
  cached = undefined;
}

export async function getEmailProvider(): Promise<EmailProvider> {
  if (override) return override;
  cached ??= createEmailProvider();
  return cached;
}

async function createEmailProvider(): Promise<EmailProvider> {
  if (process.env.NODE_ENV === "test") {
    return createMemoryEmailProvider();
  }
  const env = getServerEnvironment();
  if (env.SMTP_HOST) {
    if (process.env.NODE_ENV === "production" && !env.EMAIL_FROM) {
      return createUnconfiguredEmailProvider();
    }
    return createSmtpEmailProvider();
  }
  if (process.env.NODE_ENV === "production") {
    return createUnconfiguredEmailProvider();
  }
  return createConsoleEmailProvider();
}
