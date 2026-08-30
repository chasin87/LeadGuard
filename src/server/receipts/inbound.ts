import { extractSubmissionId } from "@/server/monitoring/form/submission-id";

export type NormalizedInboundEmail = {
  messageId: string;
  recipient: string;
  sender: string;
  subject: string;
  text: string;
  html?: string;
  receivedAt: Date;
  provider: string;
};

const maxField = 500;
const maxText = 8_000;

export function normalizeInboundMessage(
  value: unknown,
  provider: string,
): NormalizedInboundEmail | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const messageId = String(record.messageId ?? record.message_id ?? "").trim();
  const recipient = String(record.recipient ?? record.to ?? "").trim();
  if (!messageId || !recipient) return null;
  const sender = String(record.sender ?? record.from ?? "").trim();
  const subject = String(record.subject ?? "").trim();
  const text = String(record.text ?? "").slice(0, maxText);
  const html =
    typeof record.html === "string" ? record.html.slice(0, maxText) : undefined;
  const receivedRaw = record.receivedAt ?? record.received_at;
  const receivedAt =
    typeof receivedRaw === "string" || receivedRaw instanceof Date
      ? new Date(receivedRaw)
      : new Date();
  if (Number.isNaN(receivedAt.getTime())) return null;
  return {
    messageId: messageId.slice(0, 200),
    recipient: recipient.slice(0, maxField),
    sender: sender.slice(0, maxField),
    subject: subject.slice(0, 200),
    text,
    html,
    receivedAt,
    provider,
  };
}

export function submissionIdFromInboundEmail(
  message: NormalizedInboundEmail,
): string | null {
  const fromRecipient = extractSubmissionId(message.recipient);
  if (fromRecipient) return fromRecipient;
  const fromSubject = extractSubmissionId(message.subject);
  if (fromSubject) return fromSubject;
  const fromText = extractSubmissionId(message.text);
  if (fromText) return fromText;
  if (message.html) {
    const stripped = message.html.replace(/<[^>]+>/g, " ");
    return extractSubmissionId(stripped);
  }
  return null;
}

export function senderDomainFromAddress(sender: string): string | null {
  const at = sender.lastIndexOf("@");
  if (at < 0) return null;
  const domain = sender
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain || null;
}
