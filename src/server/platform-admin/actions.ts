"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { triggerBillingReconciliation } from "@/server/platform-admin/billing";
import { retrySafeJob, runMonitorNow } from "@/server/platform-admin/jobs";
import {
  reactivateOrganization,
  suspendOrganization,
} from "@/server/platform-admin/organizations";
import {
  createEntitlementOverride,
  removeEntitlementOverride,
} from "@/server/platform-admin/overrides";
import {
  grantPlatformAccess,
  revokePlatformAccess,
} from "@/server/platform-admin/roles";
import {
  disablePlatformUser,
  reactivatePlatformUser,
} from "@/server/platform-admin/users";
import type { PlatformRole } from "@/generated/prisma/enums";

export type PlatformActionState = {
  error?: string;
  message?: string;
};

function fail(error: unknown): PlatformActionState {
  if (error instanceof AuthorizationError || error instanceof DomainError) {
    return { error: error.message };
  }
  return { error: "Unable to complete this platform action." };
}

function revalidateAdmin(organizationId?: string) {
  revalidatePath("/platform-admin");
  if (organizationId) {
    revalidatePath(`/platform-admin/organizations/${organizationId}`);
  }
}

export async function suspendOrganizationAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission(
      "platform:organizations:manage",
    );
    const organizationId = String(formData.get("organizationId") ?? "");
    await suspendOrganization({
      organizationId,
      reasonCode: String(formData.get("reasonCode") ?? ""),
      details: String(formData.get("details") ?? ""),
      actor,
    });
    revalidateAdmin(organizationId);
    return { message: "Organization suspended." };
  } catch (error) {
    return fail(error);
  }
}

export async function reactivateOrganizationAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission(
      "platform:organizations:manage",
    );
    const organizationId = String(formData.get("organizationId") ?? "");
    await reactivateOrganization({
      organizationId,
      reason: String(formData.get("reason") ?? ""),
      actor,
    });
    revalidateAdmin(organizationId);
    return { message: "Organization reactivated." };
  } catch (error) {
    return fail(error);
  }
}

export async function disableUserAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission("platform:users:manage");
    const userId = String(formData.get("userId") ?? "");
    await disablePlatformUser({
      userId,
      reason: String(formData.get("reason") ?? ""),
      actor,
    });
    revalidatePath("/platform-admin/users");
    revalidatePath(`/platform-admin/users/${userId}`);
    return { message: "User disabled." };
  } catch (error) {
    return fail(error);
  }
}

export async function reactivateUserAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission("platform:users:manage");
    const userId = String(formData.get("userId") ?? "");
    await reactivatePlatformUser({
      userId,
      reason: String(formData.get("reason") ?? ""),
      actor,
    });
    revalidatePath("/platform-admin/users");
    revalidatePath(`/platform-admin/users/${userId}`);
    return { message: "User reactivated." };
  } catch (error) {
    return fail(error);
  }
}

export async function grantPlatformRoleAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission("platform:roles:manage");
    await grantPlatformAccess({
      email: String(formData.get("email") ?? ""),
      role: String(formData.get("role") ?? "") as PlatformRole,
      confirm: String(formData.get("confirm") ?? "") === "GRANT",
      reason: String(formData.get("reason") ?? ""),
      actor,
    });
    revalidatePath("/platform-admin/users");
    return { message: "Platform role granted." };
  } catch (error) {
    return fail(error);
  }
}

export async function revokePlatformRoleAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission("platform:roles:manage");
    const userId = String(formData.get("userId") ?? "");
    await revokePlatformAccess({
      userId,
      reason: String(formData.get("reason") ?? ""),
      actor,
    });
    revalidatePath("/platform-admin/users");
    revalidatePath(`/platform-admin/users/${userId}`);
    return { message: "Platform role revoked." };
  } catch (error) {
    return fail(error);
  }
}

export async function createOverrideAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission("platform:billing:manage");
    const organizationId = String(formData.get("organizationId") ?? "");
    const kind = String(formData.get("kind") ?? "");
    const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
    await createEntitlementOverride({
      organizationId,
      featureKey:
        kind === "feature" ? String(formData.get("key") ?? "") : undefined,
      limitKey:
        kind === "limit" ? String(formData.get("key") ?? "") : undefined,
      booleanValue:
        kind === "feature"
          ? String(formData.get("booleanValue") ?? "") === "true"
          : undefined,
      integerValue:
        kind === "limit"
          ? Number(formData.get("integerValue") ?? "")
          : undefined,
      expiresAt: expiresRaw ? new Date(`${expiresRaw}T00:00:00.000Z`) : null,
      reason: String(formData.get("reason") ?? ""),
      actor,
    });
    revalidateAdmin(organizationId);
    return { message: "Override created." };
  } catch (error) {
    return fail(error);
  }
}

export async function removeOverrideAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission("platform:billing:manage");
    await removeEntitlementOverride({
      overrideId: String(formData.get("overrideId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      actor,
    });
    revalidateAdmin(String(formData.get("organizationId") ?? ""));
    return { message: "Override removed." };
  } catch (error) {
    return fail(error);
  }
}

export async function reconcileBillingAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission("platform:billing:manage");
    const organizationId = String(formData.get("organizationId") ?? "");
    await triggerBillingReconciliation({
      organizationId,
      actor,
      reason: String(formData.get("reason") ?? ""),
    });
    revalidateAdmin(organizationId);
    return { message: "Billing reconciliation triggered." };
  } catch (error) {
    return fail(error);
  }
}

export async function runMonitorNowAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission("platform:monitoring:manage");
    const result = await runMonitorNow({
      monitorId: String(formData.get("monitorId") ?? ""),
      actor,
      reason: String(formData.get("reason") ?? "platform run now"),
    });
    revalidatePath("/platform-admin/monitoring");
    return { message: result.message };
  } catch (error) {
    return fail(error);
  }
}

export async function retryJobAction(
  _state: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const actor = await requirePlatformPermission("platform:operations:manage");
    const result = await retrySafeJob({
      jobName: String(formData.get("jobName") ?? ""),
      entityId: String(formData.get("entityId") ?? ""),
      actor,
      reason: String(formData.get("reason") ?? ""),
    });
    revalidatePath("/platform-admin/operations");
    return { message: result.message };
  } catch (error) {
    return fail(error);
  }
}
