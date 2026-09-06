import { database } from "@/server/database";
import type { PlatformActor } from "@/server/platform-admin/access";
import type { PlatformAuditAction } from "@/server/platform-admin/permissions";

const MAX_REASON = 240;
const MAX_METADATA = 500;

export function sanitizeAuditMetadata(
  value: Record<string, unknown> | null | undefined,
): string | null {
  if (!value) return null;
  const blocked =
    /gclid|gbraid|wbraid|refresh.?token|password|secret|smtp|encryption|sk_live|sk_test/i;
  const safe: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (blocked.test(key)) continue;
    if (typeof entry === "string" && blocked.test(entry)) continue;
    if (typeof entry === "string") {
      safe[key] = entry.slice(0, 120);
    } else if (
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null
    ) {
      safe[key] = entry;
    }
  }
  const encoded = JSON.stringify(safe);
  return encoded.slice(0, MAX_METADATA);
}

export async function recordPlatformAudit(input: {
  actor: PlatformActor | null;
  action: PlatformAuditAction;
  targetType: string;
  targetId: string;
  organizationId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await database.platformAuditEvent.create({
    data: {
      actorUserId: input.actor?.userId ?? null,
      actorPlatformRole: input.actor?.role ?? null,
      action: input.action,
      targetType: input.targetType.slice(0, 64),
      targetId: input.targetId.slice(0, 128),
      organizationId: input.organizationId ?? null,
      reason: input.reason?.trim().slice(0, MAX_REASON) || null,
      metadata: sanitizeAuditMetadata(input.metadata),
    },
  });
}
