import Link from "next/link";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { listPlatformOrganizations } from "@/server/platform-admin/queries";
import { PlatformBadge, accountTone } from "@/components/platform-badge";
import type {
  BillingPlanKey,
  BillingSubscriptionStatus,
} from "@/generated/prisma/enums";

export const metadata = { title: "Platform organizations" };

export default async function PlatformOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePlatformPermission("platform:organizations:read");
  const params = await searchParams;
  const read = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const result = await listPlatformOrganizations(actor, {
    q: read("q"),
    plan: (read("plan") ?? "") as BillingPlanKey | "",
    billingStatus: (read("billingStatus") ?? "") as
      BillingSubscriptionStatus | "",
    trial: read("trial") === "1",
    suspended: read("suspended") === "1",
    overLimit: read("overLimit") === "1",
    openIncidents: read("openIncidents") === "1",
    googleConnected: read("googleConnected") === "1",
    createdFrom: read("createdFrom"),
    createdTo: read("createdTo"),
    cursor: read("cursor"),
  });
  return (
    <div>
      <h1 className="text-2xl font-bold">Organizations</h1>
      <form
        className="mt-4 grid gap-2 rounded-xl border border-[var(--border)] bg-white p-4 md:grid-cols-4"
        method="get"
      >
        <input
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          name="q"
          placeholder="Name, slug, owner email, Stripe ID, org ID"
          defaultValue={read("q") ?? ""}
          data-testid="org-search"
        />
        <select
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          name="plan"
          defaultValue={read("plan") ?? ""}
        >
          <option value="">All plans</option>
          {["STARTER", "GROWTH", "PRO", "AGENCY", "LEGACY"].map((plan) => (
            <option key={plan} value={plan}>
              {plan}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          name="billingStatus"
          defaultValue={read("billingStatus") ?? ""}
        >
          <option value="">All billing</option>
          {[
            "TRIALING",
            "ACTIVE",
            "PAST_DUE",
            "GRACE_PERIOD",
            "SUSPENDED",
            "TRIAL_EXPIRED",
            "CANCELED",
          ].map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          type="submit"
        >
          Search
        </button>
        <label className="text-sm">
          <input
            type="checkbox"
            name="trial"
            value="1"
            defaultChecked={read("trial") === "1"}
          />{" "}
          Trial
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            name="suspended"
            value="1"
            defaultChecked={read("suspended") === "1"}
          />{" "}
          Suspended
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            name="overLimit"
            value="1"
            defaultChecked={read("overLimit") === "1"}
          />{" "}
          Over limit
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            name="openIncidents"
            value="1"
            defaultChecked={read("openIncidents") === "1"}
          />{" "}
          Open incidents
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            name="googleConnected"
            value="1"
            defaultChecked={read("googleConnected") === "1"}
          />{" "}
          Google connected
        </label>
        <input
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          type="date"
          name="createdFrom"
          defaultValue={read("createdFrom") ?? ""}
        />
        <input
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          type="date"
          name="createdTo"
          defaultValue={read("createdTo") ?? ""}
        />
      </form>
      {result.rows.length === 0 ? (
        <p className="mt-6 text-[var(--muted)]">No organizations found</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-[var(--muted)]">
              <tr>
                {[
                  "Organization",
                  "Owner",
                  "Plan",
                  "Billing",
                  "Trial",
                  "Websites",
                  "Monitors",
                  "Open incidents",
                  "Users",
                  "Created",
                  "Last activity",
                  "Status",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[var(--border)]"
                  data-testid="org-row"
                >
                  <td className="px-3 py-2">
                    <Link
                      className="font-semibold"
                      href={`/platform-admin/organizations/${row.id}`}
                    >
                      {row.name}
                    </Link>
                    <div className="text-xs text-[var(--muted)]">
                      {row.slug}
                    </div>
                  </td>
                  <td className="px-3 py-2">{row.ownerEmail ?? "—"}</td>
                  <td className="px-3 py-2">{row.plan ?? "—"}</td>
                  <td className="px-3 py-2">{row.billingStatus}</td>
                  <td className="px-3 py-2">
                    {row.trialEndsAt ? "yes" : "no"}
                  </td>
                  <td className="px-3 py-2">{row.websites}</td>
                  <td className="px-3 py-2">{row.monitors}</td>
                  <td className="px-3 py-2">{row.openIncidents}</td>
                  <td className="px-3 py-2">{row.users}</td>
                  <td className="px-3 py-2">
                    {row.createdAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    {row.lastActivity.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    <PlatformBadge tone={accountTone(row.accountStatus)}>
                      {row.accountStatus}
                    </PlatformBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.nextCursor ? (
        <Link
          className="mt-4 inline-block text-sm font-semibold"
          href={`?q=${encodeURIComponent(read("q") ?? "")}&cursor=${result.nextCursor}`}
        >
          Next page
        </Link>
      ) : null}
    </div>
  );
}
