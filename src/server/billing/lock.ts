import type { Prisma } from "@/generated/prisma/client";

export async function lockOrganizationBilling(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
}
