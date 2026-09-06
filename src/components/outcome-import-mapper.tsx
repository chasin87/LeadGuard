"use client";

import { useState, useTransition } from "react";
import {
  confirmOutcomeImportAction,
  saveOutcomeImportMappingAction,
} from "@/server/outcomes/actions";
import {
  IMPORT_FIELDS,
  type ImportField,
} from "@/server/outcomes/import-mapping";
import type { LeadOutcomeStatus } from "@/generated/prisma/enums";

export function OutcomeImportMapper({
  organizationSlug,
  importId,
  headers,
  defaultCurrency,
  preview,
}: {
  organizationSlug: string;
  importId: string;
  headers: string[];
  defaultCurrency: string | null;
  preview: Array<Record<string, unknown>>;
}) {
  const [columns, setColumns] = useState<Partial<Record<ImportField, string>>>(
    {},
  );
  const [statusMap, setStatusMap] = useState(
    "Sold=WON\nRejected=LOST\nOpen=NEW\nQualified=QUALIFIED",
  );
  const [useDefaultCurrency, setUseDefaultCurrency] = useState(false);
  const [effectivePolicy, setEffectivePolicy] = useState<
    "column" | "import_timestamp"
  >("import_timestamp");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function parsedStatusMap(): Record<string, LeadOutcomeStatus> {
    const map: Record<string, LeadOutcomeStatus> = {};
    for (const line of statusMap.split("\n")) {
      const [from, to] = line.split("=").map((part) => part.trim());
      if (!from || !to) continue;
      if (["NEW", "QUALIFIED", "WON", "LOST"].includes(to)) {
        map[from] = to as LeadOutcomeStatus;
      }
    }
    return map;
  }

  return (
    <section className="mt-8 max-w-3xl space-y-4 rounded-2xl border border-[var(--border)] bg-white p-6">
      <h2 className="text-lg font-bold">Column mapping</h2>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        {IMPORT_FIELDS.map((field) => (
          <label key={field} className="block font-semibold">
            {field}
            <select
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2 font-normal"
              value={columns[field] ?? ""}
              onChange={(event) =>
                setColumns((current) => ({
                  ...current,
                  [field]: event.target.value || undefined,
                }))
              }
            >
              <option value="">Not mapped</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label className="block text-sm font-semibold">
        Status mapping (file value = NEW|QUALIFIED|WON|LOST)
        <textarea
          className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2 font-mono text-xs"
          rows={5}
          value={statusMap}
          onChange={(event) => setStatusMap(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={useDefaultCurrency}
          onChange={(event) => setUseDefaultCurrency(event.target.checked)}
        />
        Use organization default currency
        {defaultCurrency ? ` (${defaultCurrency})` : " (not set)"} when the file
        has no currency column
      </label>
      <label className="block text-sm font-semibold">
        Effective time
        <select
          className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2 font-normal"
          value={effectivePolicy}
          onChange={(event) =>
            setEffectivePolicy(
              event.target.value as "column" | "import_timestamp",
            )
          }
        >
          <option value="import_timestamp">
            Use import timestamp as effective time
          </option>
          <option value="column">Use mapped effectiveAt column</option>
        </select>
      </label>
      {effectivePolicy === "import_timestamp" ? (
        <p className="text-sm text-amber-800">
          Rows without a business timestamp will use the import time. Later
          production import can differ if outcomes change after this preview.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm font-semibold text-red-700">{error}</p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
          disabled={pending}
          type="button"
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await saveOutcomeImportMappingAction(
                organizationSlug,
                importId,
                {
                  columns,
                  statusMap: parsedStatusMap(),
                  defaultCurrency: useDefaultCurrency ? defaultCurrency : null,
                  effectiveAtPolicy: effectivePolicy,
                },
              );
              if (result.error) setError(result.error);
            });
          }}
        >
          Save mapping / dry-run
        </button>
        <button
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          disabled={pending}
          type="button"
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await confirmOutcomeImportAction(
                organizationSlug,
                importId,
              );
              if (result.error) setError(result.error);
            });
          }}
        >
          Confirm import
        </button>
      </div>
      <div className="overflow-x-auto text-sm">
        <table className="mt-4 min-w-full text-left">
          <thead>
            <tr>
              <th className="pr-4">Row</th>
              <th className="pr-4">Result</th>
              <th className="pr-4">Lead</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((row) => (
              <tr key={String(row.rowNumber)}>
                <td className="pr-4">{String(row.rowNumber)}</td>
                <td className="pr-4">{String(row.result ?? "preview")}</td>
                <td className="pr-4">{String(row.leadId ?? "—")}</td>
                <td>{String(row.errorCode ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
