import type {
  EmailMessage,
  EmailProvider,
  EmailSendResult,
} from "@/server/notifications/email/types";

export type RecordedEmail = EmailMessage & { sentAt: Date };

export function createMemoryEmailProvider(): EmailProvider & {
  messages: RecordedEmail[];
} {
  const messages: RecordedEmail[] = [];
  return {
    kind: "memory",
    messages,
    async send(message: EmailMessage): Promise<EmailSendResult> {
      messages.push({ ...message, sentAt: new Date() });
      return { ok: true };
    },
  };
}

export type ScriptedEmailResult = EmailSendResult;

export function createScriptedEmailProvider(
  results: ScriptedEmailResult[],
): EmailProvider & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  let index = 0;
  return {
    kind: "memory",
    sent,
    async send(message: EmailMessage): Promise<EmailSendResult> {
      sent.push(message);
      const result = results[index] ?? { ok: true };
      index += 1;
      return result;
    },
  };
}
