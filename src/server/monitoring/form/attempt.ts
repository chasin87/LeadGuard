import type { FormSubmissionState } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { createFormSubmissionId } from "@/server/monitoring/form/submission-id";

const postSubmitStates = new Set<FormSubmissionState>([
  "SUBMITTING",
  "SUBMITTED",
  "CONFIRMED",
  "FAILED",
  "AMBIGUOUS",
]);

export async function prepareFormSubmissionAttempt(input: {
  monitorId: string;
  jobId: string;
}): Promise<{
  attemptId: string;
  submissionId: string;
  skipSubmit: boolean;
  existingCheckId: string | null;
  state: FormSubmissionState;
}> {
  const existing = await database.formSubmissionAttempt.findUnique({
    where: { jobId: input.jobId },
  });
  if (existing) {
    return {
      attemptId: existing.id,
      submissionId: existing.submissionId,
      skipSubmit:
        postSubmitStates.has(existing.state) || Boolean(existing.checkId),
      existingCheckId: existing.checkId,
      state: existing.state,
    };
  }
  const created = await database.formSubmissionAttempt.create({
    data: {
      monitorId: input.monitorId,
      jobId: input.jobId,
      submissionId: createFormSubmissionId(),
      state: "PREPARED",
    },
  });
  return {
    attemptId: created.id,
    submissionId: created.submissionId,
    skipSubmit: false,
    existingCheckId: null,
    state: created.state,
  };
}

export async function markFormSubmissionSubmitting(
  attemptId: string,
): Promise<void> {
  await database.formSubmissionAttempt.update({
    where: { id: attemptId },
    data: { state: "SUBMITTING" },
  });
}

export async function completeFormSubmissionAttempt(input: {
  attemptId: string;
  checkId: string;
  state: FormSubmissionState;
}): Promise<void> {
  await database.formSubmissionAttempt.update({
    where: { id: input.attemptId },
    data: {
      checkId: input.checkId,
      state: input.state,
    },
  });
}
