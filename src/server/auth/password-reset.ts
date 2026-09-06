import { createHash, randomBytes } from "node:crypto";
import { database } from "@/server/database";
import { normalizeEmail } from "@/server/auth/email";
import {
  hashPassword,
  verifyPasswordAgainstDummy,
} from "@/server/auth/password";
import { getEmailProvider } from "@/server/notifications/email/provider";
import { DomainError } from "@/server/authorization/errors";

const resetPrefix = "password-reset:";
const resetTtlMs = 60 * 60 * 1000;

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordReset(email: string, now = new Date()) {
  const normalized = normalizeEmail(email);
  const identifier = `${resetPrefix}${normalized}`;
  const user = await database.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, passwordHash: true, name: true },
  });
  if (!user?.passwordHash) {
    await verifyPasswordAgainstDummy("timing");
    return;
  }
  const raw = randomBytes(32).toString("base64url");
  const token = hashResetToken(raw);
  await database.$transaction([
    database.verificationToken.deleteMany({ where: { identifier } }),
    database.verificationToken.create({
      data: {
        identifier,
        token,
        expires: new Date(now.getTime() + resetTtlMs),
      },
    }),
  ]);
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(raw)}`;
  const provider = await getEmailProvider();
  await provider.send({
    to: user.email,
    subject: "Reset your LeadGuard password",
    text: `Hi ${user.name},\n\nUse this link within one hour to choose a new password:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hi ${user.name},</p><p>Use this link within one hour to choose a new password:</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

export async function completePasswordReset(input: {
  token: string;
  password: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const hashed = hashResetToken(input.token);
  const record = await database.verificationToken.findUnique({
    where: { token: hashed },
  });
  if (
    !record ||
    record.expires <= now ||
    !record.identifier.startsWith(resetPrefix)
  ) {
    await verifyPasswordAgainstDummy(input.password);
    throw new DomainError(
      "This reset link is invalid or has expired. Request a new one.",
    );
  }
  const email = record.identifier.slice(resetPrefix.length);
  const passwordHash = await hashPassword(input.password);
  await database.$transaction([
    database.user.update({
      where: { email },
      data: { passwordHash },
    }),
    database.verificationToken.deleteMany({
      where: { identifier: record.identifier },
    }),
  ]);
}
