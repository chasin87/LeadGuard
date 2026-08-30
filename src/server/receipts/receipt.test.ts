import { describe, expect, it } from "vitest";
import {
  createFormSubmissionId,
  extractSubmissionId,
} from "@/server/monitoring/form/submission-id";
import {
  normalizeInboundMessage,
  submissionIdFromInboundEmail,
} from "@/server/receipts/inbound";
import { authorizeInboundEmailRequest } from "@/server/receipts/auth";
import { signWebhookBody } from "@/server/notifications/webhooks/signature";
import {
  generateReceiptWebhookSecret,
  hashReceiptSecret,
} from "@/server/receipts/secrets";

describe("submission id entropy", () => {
  it("creates unique ids with a readable prefix and enough random bits", () => {
    const first = createFormSubmissionId(new Date("2026-08-30T00:00:00Z"));
    const second = createFormSubmissionId(new Date("2026-08-30T00:00:00Z"));
    expect(first).toMatch(/^LG-20260830-[A-HJ-NP-Z2-9]{12}$/);
    expect(first).not.toBe(second);
    const ids = new Set(
      Array.from({ length: 40 }, () => createFormSubmissionId()),
    );
    expect(ids.size).toBe(40);
  });

  it("extracts an exact submission id and rejects fuzzy text", () => {
    expect(extractSubmissionId("receipt+LG-20260830-ABC234XYZQRS@x.test")).toBe(
      "LG-20260830-ABC234XYZQRS",
    );
    expect(extractSubmissionId("maybe a lead id 123")).toBeNull();
  });
});

describe("inbound email parsing", () => {
  const id = "LG-20260830-ABCDEFGHJKMN";

  it("prefers the recipient plus-tag over subject and body", () => {
    const message = normalizeInboundMessage(
      {
        messageId: "m-1",
        recipient: `receipt+${id}@inbound.test`,
        sender: "crm@customer.test",
        subject: "Thanks",
        text: "hello",
        receivedAt: "2026-08-30T12:00:00.000Z",
      },
      "generic",
    );
    expect(message).not.toBeNull();
    expect(submissionIdFromInboundEmail(message!)).toBe(id);
  });

  it("falls back to the marker in subject then body", () => {
    const subject = normalizeInboundMessage(
      {
        messageId: "m-2",
        recipient: "inbox@inbound.test",
        sender: "a@b.test",
        subject: `[LEADGUARD TEST ${id}]`,
        text: "",
        receivedAt: new Date().toISOString(),
      },
      "generic",
    );
    expect(submissionIdFromInboundEmail(subject!)).toBe(id);
    const body = normalizeInboundMessage(
      {
        messageId: "m-3",
        recipient: "inbox@inbound.test",
        sender: "a@b.test",
        subject: "Lead",
        text: `[LEADGUARD TEST ${id}] automated`,
        receivedAt: new Date().toISOString(),
      },
      "generic",
    );
    expect(submissionIdFromInboundEmail(body!)).toBe(id);
  });

  it("ignores html without storing it and skips unknown ids", () => {
    const message = normalizeInboundMessage(
      {
        messageId: "m-4",
        recipient: "inbox@inbound.test",
        sender: "a@b.test",
        subject: "x",
        html: "<script>alert(1)</script> no id here",
        attachments: [{ filename: "lead.pdf", content: "aaaa" }],
        receivedAt: new Date().toISOString(),
      },
      "generic",
    );
    expect(submissionIdFromInboundEmail(message!)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(message, "attachments")).toBe(
      false,
    );
  });

  it("extracts a marker from stripped html as a last fallback", () => {
    const message = normalizeInboundMessage(
      {
        messageId: "m-5",
        recipient: "inbox@inbound.test",
        sender: "a@b.test",
        subject: "x",
        html: `<p>Thanks</p><div>[LEADGUARD TEST ${id}]</div>`,
        receivedAt: new Date().toISOString(),
      },
      "generic",
    );
    expect(submissionIdFromInboundEmail(message!)).toBe(id);
  });

  it("bounds oversized text instead of keeping a mailbox dump", () => {
    const message = normalizeInboundMessage(
      {
        messageId: "m-6",
        recipient: "inbox@inbound.test",
        sender: "a@b.test",
        subject: "x".repeat(500),
        text: "z".repeat(20_000),
        receivedAt: new Date().toISOString(),
      },
      "generic",
    );
    expect(message?.text.length).toBeLessThanOrEqual(8_000);
    expect(message?.subject.length).toBeLessThanOrEqual(200);
  });
});

describe("inbound provider authentication", () => {
  const secret = "a".repeat(32);
  const rawBody = JSON.stringify({ messageId: "m-1", recipient: "a@b.test" });

  it("accepts a bearer token or a fresh HMAC signature", () => {
    expect(
      authorizeInboundEmailRequest({
        authorizationHeader: `Bearer ${secret}`,
        timestampHeader: null,
        signatureHeader: null,
        rawBody,
        secret,
      }),
    ).toBe(true);
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(
      authorizeInboundEmailRequest({
        authorizationHeader: null,
        timestampHeader: timestamp,
        signatureHeader: signWebhookBody(secret, timestamp, rawBody),
        rawBody,
        secret,
      }),
    ).toBe(true);
  });

  it("rejects an invalid or stale signature", () => {
    expect(
      authorizeInboundEmailRequest({
        authorizationHeader: `Bearer ${"b".repeat(32)}`,
        timestampHeader: null,
        signatureHeader: null,
        rawBody,
        secret,
      }),
    ).toBe(false);
    const timestamp = String(Math.floor(Date.now() / 1000) - 60 * 60);
    expect(
      authorizeInboundEmailRequest({
        authorizationHeader: null,
        timestampHeader: timestamp,
        signatureHeader: signWebhookBody(secret, timestamp, rawBody),
        rawBody,
        secret,
        now: new Date(),
      }),
    ).toBe(false);
  });
});

describe("receipt secrets", () => {
  it("hashes secrets without returning the plaintext", () => {
    const secret = generateReceiptWebhookSecret();
    expect(secret.startsWith("lgrw_")).toBe(true);
    expect(hashReceiptSecret(secret)).toHaveLength(64);
    expect(hashReceiptSecret(secret)).not.toBe(secret);
  });
});
