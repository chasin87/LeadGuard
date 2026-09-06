"use server";

import { revalidatePath } from "next/cache";
import type { LeadOutcomeStatus } from "@/generated/prisma/enums";
import {
  AuthorizationError,
  DomainError,
  LeadNotFoundError,
  OutcomeVersionConflictError,
} from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import { LEAD_OUTCOME_STATUSES } from "@/server/leads/outcome";
import { applyLeadOutcomeMutation } from "@/server/leads/service";

export type LeadOutcomeFormState = {
  error?: string;
  conflict?: boolean;
};

function parseStatus(
  value: FormDataEntryValue | null,
): LeadOutcomeStatus | undefined {
  const raw = String(value ?? "");
  return LEAD_OUTCOME_STATUSES.find((status) => status === raw);
}

function parseEffectiveAt(value: FormDataEntryValue | null): Date | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError("Invalid outcome date.");
  }
  return parsed;
}

function outcomeActionError(error: unknown): LeadOutcomeFormState {
  if (error instanceof OutcomeVersionConflictError) {
    return { error: error.message, conflict: true };
  }
  if (error instanceof AuthorizationError) {
    return { error: "You do not have permission to change this lead." };
  }
  if (error instanceof LeadNotFoundError || error instanceof DomainError) {
    return { error: error.message };
  }
  throw error;
}

export async function updateLeadOutcomeAction(
  organizationSlug: string,
  leadId: string,
  _previous: LeadOutcomeFormState,
  formData: FormData,
): Promise<LeadOutcomeFormState> {
  void _previous;
  const user = await requireUser();
  const intent = String(formData.get("intent") ?? "save");
  try {
    const status = parseStatus(formData.get("status"));
    const amount = String(formData.get("revenueAmount") ?? "").trim();
    const currency = String(formData.get("revenueCurrency") ?? "").trim();
    const clearRevenue = intent === "clear_revenue";
    await applyLeadOutcomeMutation({
      userId: user.id,
      organizationSlug,
      leadId,
      mutationId: String(formData.get("mutationId") ?? ""),
      expectedVersion: Number(formData.get("expectedVersion")),
      status: clearRevenue ? undefined : status,
      revenue: !clearRevenue && amount ? { amount, currency } : undefined,
      clearRevenue,
      confirmTerminalTransition:
        formData.get("confirmTerminalTransition") === "true",
      effectiveAt: parseEffectiveAt(formData.get("effectiveAt")),
    });
    revalidatePath(`/app/${organizationSlug}/attribution`);
    revalidatePath(`/app/${organizationSlug}/attribution/${leadId}`);
    return {};
  } catch (error) {
    return outcomeActionError(error);
  }
}
