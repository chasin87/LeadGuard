"use server";

import { revalidatePath } from "next/cache";
import type {
  ExternalOutcomeAuthMode,
  ExternalOutcomeIntegrationType,
} from "@/generated/prisma/enums";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import {
  createOutcomeIntegration,
  rotateOutcomeIntegrationCredential,
  rotateOutcomeSigningSecret,
  setOutcomeIntegrationStatus,
} from "@/server/outcomes/integrations";
import {
  confirmOutcomeImport,
  createOutcomeImport,
  saveOutcomeImportMapping,
} from "@/server/outcomes/import-service";
import type { OutcomeImportMapping } from "@/server/outcomes/import-mapping";
import {
  ignoreExternalOutcomeEvent,
  linkUnmatchedOutcomeEvent,
} from "@/server/outcomes/reconciliation";

export type OutcomeFormState = {
  error?: string;
  credential?: string;
  signingSecret?: string;
  integrationId?: string;
};

function asError(error: unknown): OutcomeFormState {
  if (error instanceof AuthorizationError) {
    return { error: "You do not have permission to do that." };
  }
  if (error instanceof DomainError) {
    return { error: error.message };
  }
  throw error;
}

export async function createOutcomeIntegrationAction(
  organizationSlug: string,
  _previous: OutcomeFormState,
  formData: FormData,
): Promise<OutcomeFormState> {
  void _previous;
  const user = await requireUser();
  try {
    const websiteIds = formData
      .getAll("websiteIds")
      .map(String)
      .filter(Boolean);
    const created = await createOutcomeIntegration({
      userId: user.id,
      organizationSlug,
      name: String(formData.get("name") ?? ""),
      type: String(
        formData.get("type") ?? "API",
      ) as ExternalOutcomeIntegrationType,
      authMode: String(
        formData.get("authMode") ?? "BEARER",
      ) as ExternalOutcomeAuthMode,
      sourceSystem: String(formData.get("sourceSystem") ?? ""),
      websiteIds,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/outcomes`);
    return {
      credential: created.credential,
      signingSecret: created.signingSecret ?? undefined,
      integrationId: created.integration.id,
    };
  } catch (error) {
    return asError(error);
  }
}

export async function rotateOutcomeCredentialAction(
  organizationSlug: string,
  integrationId: string,
  _previous: OutcomeFormState,
  _formData: FormData,
): Promise<OutcomeFormState> {
  void _previous;
  void _formData;
  const user = await requireUser();
  try {
    const rotated = await rotateOutcomeIntegrationCredential({
      userId: user.id,
      organizationSlug,
      integrationId,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/outcomes`);
    return { credential: rotated.credential, integrationId };
  } catch (error) {
    return asError(error);
  }
}

export async function rotateOutcomeSigningSecretAction(
  organizationSlug: string,
  integrationId: string,
  _previous: OutcomeFormState,
  _formData: FormData,
): Promise<OutcomeFormState> {
  void _previous;
  void _formData;
  const user = await requireUser();
  try {
    const rotated = await rotateOutcomeSigningSecret({
      userId: user.id,
      organizationSlug,
      integrationId,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/outcomes`);
    return { signingSecret: rotated.signingSecret, integrationId };
  } catch (error) {
    return asError(error);
  }
}

export async function setOutcomeIntegrationStatusAction(
  organizationSlug: string,
  integrationId: string,
  status: "ENABLED" | "DISABLED",
) {
  const user = await requireUser();
  await setOutcomeIntegrationStatus({
    userId: user.id,
    organizationSlug,
    integrationId,
    status,
  });
  revalidatePath(`/app/${organizationSlug}/integrations/outcomes`);
}

export async function uploadOutcomeImportAction(
  organizationSlug: string,
  _previous: OutcomeFormState,
  formData: FormData,
): Promise<OutcomeFormState> {
  void _previous;
  const user = await requireUser();
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose a CSV or XLSX file." };
    }
    const body = Buffer.from(await file.arrayBuffer());
    const created = await createOutcomeImport({
      userId: user.id,
      organizationSlug,
      integrationId: String(formData.get("integrationId") ?? ""),
      fileName: file.name,
      body,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/outcomes`);
    return { integrationId: created.importRecord.id };
  } catch (error) {
    return asError(error);
  }
}

export async function saveOutcomeImportMappingAction(
  organizationSlug: string,
  importId: string,
  mapping: OutcomeImportMapping,
): Promise<OutcomeFormState> {
  const user = await requireUser();
  try {
    await saveOutcomeImportMapping({
      userId: user.id,
      organizationSlug,
      importId,
      mapping,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/outcomes`);
    return {};
  } catch (error) {
    return asError(error);
  }
}

export async function confirmOutcomeImportAction(
  organizationSlug: string,
  importId: string,
): Promise<OutcomeFormState> {
  const user = await requireUser();
  try {
    await confirmOutcomeImport({
      userId: user.id,
      organizationSlug,
      importId,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/outcomes`);
    return {};
  } catch (error) {
    return asError(error);
  }
}

export async function ignoreOutcomeEventAction(
  organizationSlug: string,
  eventId: string,
): Promise<OutcomeFormState> {
  const user = await requireUser();
  try {
    await ignoreExternalOutcomeEvent({
      userId: user.id,
      organizationSlug,
      eventId,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/outcomes`);
    return {};
  } catch (error) {
    return asError(error);
  }
}

export async function linkOutcomeEventAction(
  organizationSlug: string,
  eventId: string,
  _previous: OutcomeFormState,
  formData: FormData,
): Promise<OutcomeFormState> {
  void _previous;
  const user = await requireUser();
  try {
    await linkUnmatchedOutcomeEvent({
      userId: user.id,
      organizationSlug,
      eventId,
      publicLeadId: String(formData.get("publicLeadId") ?? ""),
      externalLeadId: String(formData.get("externalLeadId") ?? ""),
      websiteId: String(formData.get("websiteId") ?? "") || undefined,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/outcomes`);
    revalidatePath(`/app/${organizationSlug}/attribution`);
    return {};
  } catch (error) {
    return asError(error);
  }
}
