import { PlatformBadge } from "@/components/platform-badge";
import { PlatformConfirmForm } from "@/components/platform-confirm-form";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { hasPlatformPermission } from "@/server/platform-admin/permissions";
import { getOperationsHealth } from "@/server/platform-admin/health";
import { listFailedJobs } from "@/server/platform-admin/jobs";
import { retryJobAction } from "@/server/platform-admin/actions";
import { googleConversionSubmitQueue } from "@/server/google-data-manager/config";
import { monitorCheckQueue } from "@/server/monitoring/config";
import { browserCheckQueue } from "@/server/monitoring/browser/config";

export const metadata = { title: "Platform operations" };

function tone(status: string): "ok" | "warn" | "danger" | "neutral" {
  if (status === "HEALTHY") return "ok";
  if (status === "DEGRADED") return "warn";
  if (status === "STALE" || status === "MISSING") return "danger";
  return "neutral";
}

export default async function PlatformOperationsPage() {
  const actor = await requirePlatformPermission("platform:operations:read");
  const canRetry = hasPlatformPermission(
    actor.role,
    "platform:operations:manage",
  );
  const [health, failed] = await Promise.all([
    getOperationsHealth(),
    listFailedJobs(),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold">Operations</h1>
      <section
        className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4"
        data-testid="worker-health"
      >
        <h2 className="font-semibold">Workers</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {health.workers.map((worker) => (
            <li key={worker.workerType}>
              <PlatformBadge tone={tone(worker.status)}>
                {worker.status}
              </PlatformBadge>{" "}
              {worker.workerType} · {worker.instanceId ?? "none"} ·{" "}
              {worker.lastSeenAt?.toISOString() ?? "never"} ·{" "}
              {worker.version ?? "n/a"}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm">
          Scheduler last tick:{" "}
          {health.scheduler.lastTick?.toISOString() ?? "never"}
        </p>
      </section>
      <section
        className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4"
        data-testid="queue-summary"
      >
        <h2 className="font-semibold">Queues</h2>
        {health.summaries.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">No queue summary</p>
        ) : (
          <table className="mt-2 min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="py-1">Queue</th>
                <th>Pending</th>
                <th>Running</th>
                <th>Failed</th>
                <th>Oldest pending</th>
              </tr>
            </thead>
            <tbody>
              {health.summaries.map((row) => (
                <tr key={row.name} className="border-t border-[var(--border)]">
                  <td className="py-1">{row.name}</td>
                  <td>{row.pending}</td>
                  <td>{row.running}</td>
                  <td>{row.failed}</td>
                  <td>
                    {row.oldestPendingAgeMs != null
                      ? `${Math.round(row.oldestPendingAgeMs / 1000)}s`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold">Failed jobs</h2>
        {failed.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">No failed jobs</p>
        ) : (
          <ul className="mt-2 space-y-3 text-sm">
            {failed.map((job) => (
              <li key={job.id}>
                {job.name} · {job.errorCode ?? "error"} · attempts{" "}
                {job.attempts} · {job.createdAt.toISOString()}
                {canRetry &&
                (job.name === monitorCheckQueue ||
                  job.name === browserCheckQueue ||
                  job.name === googleConversionSubmitQueue) ? (
                  <p className="text-xs text-[var(--muted)]">
                    Retry uses the existing service. Provide the monitor or
                    export ID.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canRetry ? (
          <PlatformConfirmForm
            action={retryJobAction}
            confirmLabel="Type RETRY"
            confirmValue="RETRY"
            hidden={{}}
            fields={
              <>
                <label className="block text-sm font-semibold">
                  Job name
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                    name="jobName"
                    required
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Entity ID
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                    name="entityId"
                    required
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Reason
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                    name="reason"
                    required
                  />
                </label>
              </>
            }
            submitLabel="Retry job"
          />
        ) : null}
      </section>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        <h2 className="font-semibold">Providers</h2>
        <p>
          Stripe: {health.stripe.configured ? "configured" : "not live"} · last
          webhook {health.stripe.lastWebhookType ?? "none"}
        </p>
        <p>
          Email: {health.email.configured ? "configured" : "unconfigured"} ·
          last {health.email.lastDeliveryStatus ?? "none"}
        </p>
        <p>Storage: {health.storage.driver}</p>
        <p>
          Google: {health.google.configured ? "configured" : "unconfigured"}
        </p>
      </section>
    </div>
  );
}
