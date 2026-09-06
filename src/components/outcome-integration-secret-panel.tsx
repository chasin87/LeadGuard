"use client";

import { useActionState } from "react";
import {
  rotateOutcomeCredentialAction,
  rotateOutcomeSigningSecretAction,
  setOutcomeIntegrationStatusAction,
  type OutcomeFormState,
} from "@/server/outcomes/actions";

export function OutcomeIntegrationSecretPanel({
  organizationSlug,
  integrationId,
  maskedCredential,
  authMode,
  status,
}: {
  organizationSlug: string;
  integrationId: string;
  maskedCredential: string;
  authMode: "BEARER" | "HMAC";
  status: "ENABLED" | "DISABLED";
}) {
  const rotateCred = rotateOutcomeCredentialAction.bind(
    null,
    organizationSlug,
    integrationId,
  );
  const rotateSign = rotateOutcomeSigningSecretAction.bind(
    null,
    organizationSlug,
    integrationId,
  );
  const [credState, credAction, rotatingCred] = useActionState(
    rotateCred,
    {} as OutcomeFormState,
  );
  const [signState, signAction, rotatingSign] = useActionState(
    rotateSign,
    {} as OutcomeFormState,
  );
  const nextStatus = status === "ENABLED" ? "DISABLED" : "ENABLED";

  return (
    <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
      <h2 className="text-lg font-bold">Credentials</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">{maskedCredential}</p>
      {credState.credential ? (
        <p className="mt-3 break-all text-sm">
          New credential (shown once): {credState.credential}
        </p>
      ) : null}
      {signState.signingSecret ? (
        <p className="mt-3 break-all text-sm">
          New signing secret (shown once): {signState.signingSecret}
        </p>
      ) : null}
      {credState.error || signState.error ? (
        <p className="mt-2 text-sm font-semibold text-red-700">
          {credState.error ?? signState.error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <form action={credAction}>
          <button
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
            disabled={rotatingCred}
            type="submit"
          >
            Rotate credential
          </button>
        </form>
        {authMode === "HMAC" ? (
          <form action={signAction}>
            <button
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
              disabled={rotatingSign}
              type="submit"
            >
              Rotate signing secret
            </button>
          </form>
        ) : null}
        <form
          action={setOutcomeIntegrationStatusAction.bind(
            null,
            organizationSlug,
            integrationId,
            nextStatus,
          )}
        >
          <button
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
            type="submit"
          >
            {nextStatus === "DISABLED" ? "Disable" : "Enable"}
          </button>
        </form>
      </div>
    </section>
  );
}
