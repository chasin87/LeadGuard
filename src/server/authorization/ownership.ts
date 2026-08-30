import type { OrganizationRole } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { DomainError } from "./errors";

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export async function countOrganizationOwners(
  client: TransactionClient,
  organizationId: string,
): Promise<number> {
  return client.organizationMember.count({
    where: { organizationId, role: "OWNER" },
  });
}

export async function assertOrganizationKeepsOwner(params: {
  client: TransactionClient;
  organizationId: string;
  currentRole: OrganizationRole;
  nextRole?: OrganizationRole | null;
}): Promise<void> {
  if (params.currentRole !== "OWNER") return;
  if (params.nextRole === "OWNER") return;

  const owners = await countOrganizationOwners(
    params.client,
    params.organizationId,
  );
  if (owners <= 1) {
    throw new DomainError(
      "De laatste eigenaar van een organisatie kan niet worden verwijderd of gedegradeerd.",
    );
  }
}
