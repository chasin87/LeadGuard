"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createMonitorSchema,
  monitorStatusSchema,
  updateMonitorSchema,
} from "@/lib/validation/monitor";
import {
  createFormMonitorSchema,
  updateFormMonitorSchema,
} from "@/lib/validation/form-monitor";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import { MonitorNotFoundError } from "@/server/security/errors";
import {
  createMonitor,
  deleteMonitor,
  enqueueFormRealTest,
  enqueueFormValidation,
  enqueueManualMonitorCheck,
  rotateFormReceiptWebhookSecret,
  setMonitorStatus,
  updateFormReceiptSettings,
  updateMonitor,
} from "@/server/monitors/service";

export type MonitorFormState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  webhookSecret?: string;
};

function monitorBase(organizationSlug: string, websiteId: string) {
  return `/app/${organizationSlug}/websites/${websiteId}`;
}

export async function createMonitorAction(
  organizationSlug: string,
  websiteId: string,
  _previous: MonitorFormState,
  formData: FormData,
): Promise<MonitorFormState> {
  const user = await requireUser();
  if (formData.get("type") === "FORM") {
    const parsed = createFormMonitorSchema.safeParse({
      type: "FORM",
      name: formData.get("name"),
      url: formData.get("url"),
      intervalSeconds: formData.get("intervalSeconds"),
      timeoutMs: formData.get("timeoutMs"),
      consecutiveFailuresBeforeIncident: formData.get(
        "consecutiveFailuresBeforeIncident",
      ),
      viewport: formData.get("viewport") || undefined,
      formSelector: formData.get("formSelector"),
      submitSelector: formData.get("submitSelector"),
      cookieAcceptSelector: formData.get("cookieAcceptSelector") || "",
      fieldMappings: formData.get("fieldMappings") || "[]",
      successMode: formData.get("successMode") || "ANY",
      successSelector: formData.get("successSelector") || "",
      successUrlPattern: formData.get("successUrlPattern") || "",
      successText: formData.get("successText") || "",
      submissionTimeoutMs: formData.get("submissionTimeoutMs") || undefined,
      testProfileId: formData.get("testProfileId") || undefined,
      testProfileName: formData.get("testProfileName") || undefined,
      testDisplayName: formData.get("testDisplayName") || undefined,
      testEmail: formData.get("testEmail") || undefined,
      testPhone: formData.get("testPhone") || undefined,
      testPostcode: formData.get("testPostcode") || undefined,
      testCity: formData.get("testCity") || undefined,
      testCompany: formData.get("testCompany") || undefined,
      plusAddressing: formData.get("plusAddressing") ? "true" : "",
      safeFormConfirmed: formData.get("safeFormConfirmed") || "",
      submitConsentConfirmed: formData.get("submitConsentConfirmed") || "",
    });
    if (!parsed.success) {
      return { fieldErrors: parsed.error.flatten().fieldErrors };
    }
    try {
      const monitor = await createMonitor({
        userId: user.id,
        organizationSlug,
        websiteId,
        ...parsed.data,
        consented: true,
        plusAddressing:
          parsed.data.plusAddressing === "true" ||
          parsed.data.plusAddressing === "on",
      });
      redirect(
        `${monitorBase(organizationSlug, websiteId)}/monitors/${monitor.id}`,
      );
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return { error: "You do not have permission to manage monitors." };
      }
      if (error instanceof DomainError) {
        return { error: error.message };
      }
      throw error;
    }
  }
  const parsed = createMonitorSchema.safeParse({
    type: formData.get("type") || "HTTP",
    name: formData.get("name"),
    url: formData.get("url"),
    intervalSeconds: formData.get("intervalSeconds"),
    timeoutMs: formData.get("timeoutMs"),
    consecutiveFailuresBeforeIncident: formData.get(
      "consecutiveFailuresBeforeIncident",
    ),
    viewport: formData.get("viewport") || undefined,
    requiredSelector: formData.get("requiredSelector") || "",
    requiredElementName: formData.get("requiredElementName") || "",
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const monitor = await createMonitor({
      userId: user.id,
      organizationSlug,
      websiteId,
      ...parsed.data,
    });
    redirect(
      `${monitorBase(organizationSlug, websiteId)}/monitors/${monitor.id}`,
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage monitors." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function updateMonitorAction(
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
  _previous: MonitorFormState,
  formData: FormData,
): Promise<MonitorFormState> {
  const user = await requireUser();
  if (formData.get("type") === "FORM") {
    const parsed = updateFormMonitorSchema.safeParse({
      type: "FORM",
      name: formData.get("name"),
      url: formData.get("url"),
      intervalSeconds: formData.get("intervalSeconds"),
      timeoutMs: formData.get("timeoutMs"),
      status: formData.get("status"),
      consecutiveFailuresBeforeIncident: formData.get(
        "consecutiveFailuresBeforeIncident",
      ),
      viewport: formData.get("viewport") || undefined,
      formSelector: formData.get("formSelector"),
      submitSelector: formData.get("submitSelector"),
      cookieAcceptSelector: formData.get("cookieAcceptSelector") || "",
      fieldMappings: formData.get("fieldMappings") || "[]",
      successMode: formData.get("successMode") || "ANY",
      successSelector: formData.get("successSelector") || "",
      successUrlPattern: formData.get("successUrlPattern") || "",
      successText: formData.get("successText") || "",
      submissionTimeoutMs: formData.get("submissionTimeoutMs") || undefined,
      testProfileId: formData.get("testProfileId") || undefined,
    });
    if (!parsed.success) {
      return { fieldErrors: parsed.error.flatten().fieldErrors };
    }
    try {
      const { plusAddressing: _plus, type: _type, ...formFields } = parsed.data;
      void _plus;
      void _type;
      await updateMonitor({
        userId: user.id,
        organizationSlug,
        websiteId,
        monitorId,
        ...formFields,
      });
      const base = `${monitorBase(organizationSlug, websiteId)}/monitors/${monitorId}`;
      revalidatePath(base);
      revalidatePath(`${base}/settings`);
      revalidatePath(monitorBase(organizationSlug, websiteId));
      return {};
    } catch (error) {
      if (error instanceof MonitorNotFoundError) {
        return { error: "Monitor not found." };
      }
      if (error instanceof AuthorizationError) {
        return { error: "You do not have permission to manage monitors." };
      }
      if (error instanceof DomainError) {
        return { error: error.message };
      }
      return { error: "Saving failed." };
    }
  }
  const parsed = updateMonitorSchema.safeParse({
    type: formData.get("type") || undefined,
    name: formData.get("name"),
    url: formData.get("url"),
    intervalSeconds: formData.get("intervalSeconds"),
    timeoutMs: formData.get("timeoutMs"),
    status: formData.get("status"),
    consecutiveFailuresBeforeIncident: formData.get(
      "consecutiveFailuresBeforeIncident",
    ),
    viewport: formData.get("viewport") || undefined,
    requiredSelector: formData.get("requiredSelector") || "",
    requiredElementName: formData.get("requiredElementName") || "",
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateMonitor({
      userId: user.id,
      organizationSlug,
      websiteId,
      monitorId,
      ...parsed.data,
    });
    const base = `${monitorBase(organizationSlug, websiteId)}/monitors/${monitorId}`;
    revalidatePath(base);
    revalidatePath(`${base}/settings`);
    revalidatePath(monitorBase(organizationSlug, websiteId));
    return {};
  } catch (error) {
    if (error instanceof MonitorNotFoundError) {
      return { error: "Monitor not found." };
    }
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage monitors." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Saving failed." };
  }
}

export async function setMonitorStatusAction(
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
  _previous: MonitorFormState,
  formData: FormData,
): Promise<MonitorFormState> {
  const user = await requireUser();
  const parsed = monitorStatusSchema.safeParse(formData.get("status"));
  if (!parsed.success) {
    return { error: "Invalid monitor status." };
  }
  try {
    await setMonitorStatus({
      userId: user.id,
      organizationSlug,
      websiteId,
      monitorId,
      status: parsed.data,
    });
    revalidatePath(
      `${monitorBase(organizationSlug, websiteId)}/monitors/${monitorId}`,
    );
    revalidatePath(monitorBase(organizationSlug, websiteId));
    return {};
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Updating the monitor status failed." };
  }
}

export async function runMonitorCheckAction(
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
  _previous: MonitorFormState,
  _formData: FormData,
): Promise<MonitorFormState> {
  void _previous;
  void _formData;
  const user = await requireUser();
  try {
    const result = await enqueueManualMonitorCheck({
      userId: user.id,
      organizationSlug,
      websiteId,
      monitorId,
    });
    revalidatePath(
      `${monitorBase(organizationSlug, websiteId)}/monitors/${monitorId}`,
    );
    return { message: result.message };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage monitors." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Queuing the check failed." };
  }
}

export async function validateFormMonitorAction(
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
  _previous: MonitorFormState,
  _formData: FormData,
): Promise<MonitorFormState> {
  void _previous;
  void _formData;
  const user = await requireUser();
  try {
    const result = await enqueueFormValidation({
      userId: user.id,
      organizationSlug,
      websiteId,
      monitorId,
    });
    revalidatePath(
      `${monitorBase(organizationSlug, websiteId)}/monitors/${monitorId}`,
    );
    return { message: result.message };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage monitors." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Queuing configuration validation failed." };
  }
}

export async function sendFormTestAction(
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
  _previous: MonitorFormState,
  formData: FormData,
): Promise<MonitorFormState> {
  void _previous;
  const user = await requireUser();
  try {
    const result = await enqueueFormRealTest({
      userId: user.id,
      organizationSlug,
      websiteId,
      monitorId,
      confirmed:
        formData.get("confirmed") === "on" ||
        formData.get("confirmed") === "true",
    });
    revalidatePath(
      `${monitorBase(organizationSlug, websiteId)}/monitors/${monitorId}`,
    );
    return { message: result.message };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage monitors." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Queuing the real test failed." };
  }
}

export async function updateFormReceiptSettingsAction(
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
  _previous: MonitorFormState,
  formData: FormData,
): Promise<MonitorFormState> {
  void _previous;
  const user = await requireUser();
  const timeout = Number(formData.get("receiptTimeoutMinutes") || "15");
  const mode = formData.get("receiptMode");
  if (
    mode !== "NONE" &&
    mode !== "INBOUND_EMAIL" &&
    mode !== "RECEIPT_WEBHOOK"
  ) {
    return { error: "Choose a receipt verification method." };
  }
  try {
    const result = await updateFormReceiptSettings({
      userId: user.id,
      organizationSlug,
      websiteId,
      monitorId,
      receiptMode: mode,
      receiptTimeoutMinutes: Number.isInteger(timeout) ? timeout : 15,
    });
    revalidatePath(
      `${monitorBase(organizationSlug, websiteId)}/monitors/${monitorId}`,
    );
    revalidatePath(
      `${monitorBase(organizationSlug, websiteId)}/monitors/${monitorId}/settings`,
    );
    return {
      message: "Receipt settings saved.",
      webhookSecret: result.webhookSecret,
    };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage monitors." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Saving receipt settings failed." };
  }
}

export async function rotateFormReceiptWebhookSecretAction(
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
  _previous: MonitorFormState,
  _formData: FormData,
): Promise<MonitorFormState> {
  void _previous;
  void _formData;
  const user = await requireUser();
  try {
    const secret = await rotateFormReceiptWebhookSecret({
      userId: user.id,
      organizationSlug,
      websiteId,
      monitorId,
    });
    revalidatePath(
      `${monitorBase(organizationSlug, websiteId)}/monitors/${monitorId}/settings`,
    );
    return {
      message: "Signing secret rotated. Store the new value now.",
      webhookSecret: secret,
    };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage monitors." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Rotating the secret failed." };
  }
}

export async function deleteMonitorAction(
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
  previous: MonitorFormState,
  formData: FormData,
): Promise<MonitorFormState> {
  void previous;
  void formData;
  const user = await requireUser();
  try {
    await deleteMonitor({
      userId: user.id,
      organizationSlug,
      websiteId,
      monitorId,
    });
    revalidatePath(monitorBase(organizationSlug, websiteId));
    redirect(monitorBase(organizationSlug, websiteId));
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}
