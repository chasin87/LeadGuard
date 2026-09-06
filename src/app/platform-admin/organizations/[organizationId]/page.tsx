import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformBadge, accountTone } from "@/components/platform-badge";
import { PlatformConfirmForm } from "@/components/platform-confirm-form";
import { hasPlatformPermission } from "@/server/platform-admin/permissions";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import {
  getOrganizationIntegrations,
  getOrganizationRevenueSummary,
  getPlatformOrganization,
  listConversionExportsForOrganization,
  listPlatformAudit,
} from "@/server/platform-admin/queries";
import { listBillingProviderEvents } from "@/server/platform-admin/health";
import {
  createOverrideAction,
  reactivateOrganizationAction,
  reconcileBillingAction,
  removeOverrideAction,
  runMonitorNowAction,
  suspendOrganizationAction,
} from "@/server/platform-admin/actions";
import { MANUAL_SUSPENSION_REASONS } from "@/server/platform-admin/constants";
import { limitForResource } from "@/server/billing/entitlements";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Organization" };

const tabs = [
  "overview",
  "users",
  "billing",
  "usage",
  "websites",
  "monitors",
  "incidents",
  "integrations",
  "leads",
  "revenue",
  "operations",
  "audit",
] as const;

export default async function PlatformOrganizationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePlatformPermission("platform:organizations:read");
  const { organizationId } = await params;
  const query = await searchParams;
  const tabRaw = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab = tabs.includes(tabRaw as (typeof tabs)[number])
    ? (tabRaw as (typeof tabs)[number])
    : "overview";
  const detail = await getPlatformOrganization(organizationId);
  if (!detail) notFound();
  const { organization, entitlements, monitors, accountStatus } = detail;
  const canManage = hasPlatformPermission(
    actor.role,
    "platform:organizations:manage",
  );
  const canBilling = hasPlatformPermission(
    actor.role,
    "platform:billing:manage",
  );
  const canMonitor = hasPlatformPermission(
    actor.role,
    "platform:monitoring:manage",
  );
  const exactRevenue = hasPlatformPermission(
    actor.role,
    "platform:revenue:read",
  );
  const usageRows = [
    ["Websites", entitlements.limits.maxWebsites, "websites"],
    ["Monitors", entitlements.limits.maxMonitors, "monitors"],
    ["Form monitors", entitlements.limits.maxFormMonitors, "formMonitors"],
    ["Members", entitlements.limits.maxOrganizationMembers, "members"],
    [
      "Google Ads customers",
      entitlements.limits.maxGoogleAdsCustomers,
      "googleAdsCustomers",
    ],
    [
      "Outcome integrations",
      entitlements.limits.maxOutcomeIntegrations,
      "outcomeIntegrations",
    ],
  ] as const;

  return (
    <div>
      <p className="text-sm text-[var(--muted)]">
        <Link href="/platform-admin/organizations">Organizations</Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">{organization.name}</h1>
      <div className="mt-2 flex flex-wrap gap-2">
        <PlatformBadge tone={accountTone(accountStatus)}>
          {accountStatus}
        </PlatformBadge>
        <PlatformBadge tone="neutral">{entitlements.status}</PlatformBadge>
        <PlatformBadge tone="neutral">{entitlements.planName}</PlatformBadge>
      </div>
      <nav className="mt-4 flex flex-wrap gap-2 text-sm">
        {tabs.map((item) => (
          <Link
            key={item}
            href={`/platform-admin/organizations/${organization.id}?tab=${item}`}
            className={`rounded-lg px-3 py-1 font-semibold ${tab === item ? "bg-slate-900 text-white" : "bg-white border border-[var(--border)]"}`}
            data-testid={`tab-${item}`}
          >
            {item}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <section className="mt-6 space-y-2 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
          <p>Organization ID: {organization.id}</p>
          <p>Name: {organization.name}</p>
          <p>Slug: {organization.slug}</p>
          <p>Created: {organization.createdAt.toISOString()}</p>
          <p>
            Owner:{" "}
            {organization.members.find((m) => m.role === "OWNER")?.user.email ??
              "—"}
          </p>
          <p>Plan: {entitlements.planName}</p>
          <p>Subscription: {entitlements.status}</p>
          <p>Trial: {entitlements.trialEndsAt?.toISOString() ?? "none"}</p>
          <p>Billing state: {entitlements.effectiveStatus}</p>
          <p data-testid="account-status">Account status: {accountStatus}</p>
          {organization.manualSuspensionReason ? (
            <p>Manual suspension: {organization.manualSuspensionReason}</p>
          ) : null}
          {canManage ? (
            organization.manualSuspendedAt ? (
              <PlatformConfirmForm
                action={reactivateOrganizationAction}
                confirmLabel={`Type ${organization.name} to reactivate`}
                confirmValue={organization.name}
                hidden={{ organizationId: organization.id }}
                fields={
                  <label className="block text-sm font-semibold">
                    Reason
                    <input
                      className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                      name="reason"
                      required
                      minLength={3}
                    />
                  </label>
                }
                submitLabel="Reactivate organization"
              />
            ) : (
              <PlatformConfirmForm
                action={suspendOrganizationAction}
                confirmLabel={`Type ${organization.name} to suspend`}
                confirmValue={organization.name}
                hidden={{ organizationId: organization.id }}
                fields={
                  <>
                    <label className="block text-sm font-semibold">
                      Reason
                      <select
                        className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                        name="reasonCode"
                        required
                      >
                        {MANUAL_SUSPENSION_REASONS.map((reason) => (
                          <option key={reason}>{reason}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm font-semibold">
                      Details
                      <input
                        className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                        name="details"
                        maxLength={240}
                      />
                    </label>
                  </>
                }
                submitLabel={`Suspend ${organization.name}?`}
              />
            )
          ) : null}
        </section>
      ) : null}

      {tab === "users" ? (
        <section className="mt-6 overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-[var(--muted)]">
              <tr>
                {[
                  "Name",
                  "Email",
                  "Role",
                  "Joined",
                  "Last login",
                  "Status",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {organization.members.map((member) => (
                <tr key={member.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2">{member.user.name}</td>
                  <td className="px-3 py-2">
                    <Link href={`/platform-admin/users/${member.user.id}`}>
                      {member.user.email}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{member.role}</td>
                  <td className="px-3 py-2">
                    {member.createdAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    {member.user.lastLoginAt?.toISOString().slice(0, 10) ?? "—"}
                  </td>
                  <td className="px-3 py-2">{member.user.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === "billing" ? (
        <BillingTab
          organization={organization}
          entitlements={entitlements}
          canBilling={canBilling}
        />
      ) : null}

      {tab === "usage" ? (
        <UsageTab
          organizationId={organization.id}
          entitlements={entitlements}
          usageRows={usageRows}
          canBilling={canBilling}
        />
      ) : null}

      {tab === "websites" ? (
        <section className="mt-6 overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
          {organization.websites.length === 0 ? (
            <p className="p-4 text-[var(--muted)]">No websites found</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-[var(--muted)]">
                <tr>
                  {[
                    "Domain",
                    "Status",
                    "Monitors",
                    "Tracking",
                    "Google mapping",
                    "Created",
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {organization.websites.map((site) => (
                  <tr key={site.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">{site.hostname}</td>
                    <td className="px-3 py-2">{site.status}</td>
                    <td className="px-3 py-2">{site._count.monitors}</td>
                    <td className="px-3 py-2">
                      {site.trackingConfig?.status ?? "DISABLED"}
                    </td>
                    <td className="px-3 py-2">
                      {site.googleAdsAnalyticsConfig?.status ?? "none"}
                    </td>
                    <td className="px-3 py-2">
                      {site.createdAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {tab === "monitors" ? (
        <section className="mt-6 overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
          {monitors.length === 0 ? (
            <p className="p-4 text-[var(--muted)]">No monitors found</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-[var(--muted)]">
                <tr>
                  {[
                    "Type",
                    "Target",
                    "Status",
                    "Last check",
                    "Open incident",
                    "Action",
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monitors.map((monitor) => (
                  <tr
                    key={monitor.id}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-3 py-2">{monitor.type}</td>
                    <td className="px-3 py-2">{monitor.url}</td>
                    <td className="px-3 py-2">{monitor.status}</td>
                    <td className="px-3 py-2">
                      {monitor.lastCheckedAt?.toISOString() ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {monitor.incidents[0] ? "yes" : "no"}
                    </td>
                    <td className="px-3 py-2">
                      {canMonitor && monitor.type !== "FORM" ? (
                        <PlatformConfirmForm
                          action={runMonitorNowAction}
                          confirmLabel="Type RUN to queue a check"
                          confirmValue="RUN"
                          hidden={{
                            monitorId: monitor.id,
                            reason: "platform run now",
                          }}
                          fields={null}
                          submitLabel="Run now"
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {tab === "incidents" ? (
        <p className="mt-6">
          <Link
            className="font-semibold"
            href={`/platform-admin/incidents?organizationId=${organization.id}`}
          >
            Open incident list for this organization
          </Link>
        </p>
      ) : null}

      {tab === "integrations" ? (
        <IntegrationsTab
          organizationId={organization.id}
          exactRevenue={exactRevenue}
        />
      ) : null}

      {tab === "leads" || tab === "revenue" ? (
        <RevenueTab
          organizationId={organization.id}
          exactRevenue={exactRevenue}
        />
      ) : null}

      {tab === "operations" ? (
        <OperationsOrgTab organizationId={organization.id} />
      ) : null}

      {tab === "audit" ? <AuditTab organizationId={organization.id} /> : null}
    </div>
  );
}

async function BillingTab({
  organization,
  entitlements,
  canBilling,
}: {
  organization: NonNullable<
    Awaited<ReturnType<typeof getPlatformOrganization>>
  >["organization"];
  entitlements: NonNullable<
    Awaited<ReturnType<typeof getPlatformOrganization>>
  >["entitlements"];
  canBilling: boolean;
}) {
  const events = await listBillingProviderEvents(organization.id);
  const sub = organization.billingSubscription;
  return (
    <section className="mt-6 space-y-3 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
      <p>Plan: {entitlements.planName}</p>
      <p>
        Stripe customer:{" "}
        {organization.billingCustomer?.providerCustomerId ?? "—"}
      </p>
      <p>Stripe subscription: {sub?.providerSubscriptionId ?? "—"}</p>
      <p>Provider status: {sub?.providerStatus ?? "—"}</p>
      <p>LeadGuard status: {sub?.status ?? "NONE"}</p>
      <p>Trial: {sub?.trialEnd?.toISOString() ?? "none"}</p>
      <p>Current period: {sub?.currentPeriodEnd?.toISOString() ?? "—"}</p>
      <p>Cancel at period end: {sub?.cancelAtPeriodEnd ? "yes" : "no"}</p>
      <p>Past due / grace: {sub?.graceDeadlineAt?.toISOString() ?? "—"}</p>
      <p>Over limit: {entitlements.overLimit ? "yes" : "no"}</p>
      {canBilling ? (
        <PlatformConfirmForm
          action={reconcileBillingAction}
          confirmLabel="Type RECONCILE to refresh billing"
          confirmValue="RECONCILE"
          hidden={{ organizationId: organization.id }}
          fields={
            <label className="block text-sm font-semibold">
              Reason
              <input
                className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                name="reason"
                required
                minLength={3}
              />
            </label>
          }
          submitLabel="Reconcile billing"
        />
      ) : null}
      <h2 className="pt-4 font-semibold">Provider events</h2>
      {events.length === 0 ? (
        <p className="text-[var(--muted)]">No billing provider events</p>
      ) : (
        <ul className="space-y-1">
          {events.map((event) => (
            <li key={event.id}>
              {event.type} · {event.status} · {event.receivedAt.toISOString()} ·{" "}
              {event.errorCode ?? "ok"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function UsageTab({
  organizationId,
  entitlements,
  usageRows,
  canBilling,
}: {
  organizationId: string;
  entitlements: NonNullable<
    Awaited<ReturnType<typeof getPlatformOrganization>>
  >["entitlements"];
  usageRows: ReadonlyArray<
    readonly [
      string,
      number,
      (
        | "websites"
        | "monitors"
        | "formMonitors"
        | "members"
        | "googleAdsCustomers"
        | "outcomeIntegrations"
      ),
    ]
  >;
  canBilling: boolean;
}) {
  const { getOrganizationUsage } = await import("@/server/billing/usage");
  const usage = await getOrganizationUsage(organizationId);
  const detail = await getPlatformOrganization(organizationId);
  return (
    <section className="mt-6 space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        {usageRows.map(([label, allowed, key]) => {
          const used = usage[key];
          const over = used > allowed;
          return (
            <p
              key={key}
              className={over ? "font-semibold text-red-800" : "text-sm"}
            >
              {label}: {used} / {allowed}
              {over ? " — over limit" : ""}
            </p>
          );
        })}
        <p className="mt-2 text-xs text-[var(--muted)]">
          Included {limitForResource(entitlements.limits, "websites")} websites
          on current entitlements.
        </p>
      </div>
      {canBilling ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <h2 className="font-semibold">Entitlement overrides</h2>
          <ul className="mt-2 text-sm">
            {detail?.organization.entitlementOverrides.map((row) => (
              <li key={row.id}>
                {row.limitKey ?? row.featureKey}:{" "}
                {String(row.integerValue ?? row.booleanValue)} ({row.reason})
                <PlatformConfirmForm
                  action={removeOverrideAction}
                  confirmLabel="Type REMOVE"
                  confirmValue="REMOVE"
                  hidden={{ overrideId: row.id, organizationId }}
                  fields={
                    <label className="block text-sm font-semibold">
                      Reason
                      <input
                        className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                        name="reason"
                        required
                      />
                    </label>
                  }
                  submitLabel="Remove override"
                />
              </li>
            ))}
          </ul>
          <PlatformConfirmForm
            action={createOverrideAction}
            confirmLabel="Type OVERRIDE"
            confirmValue="OVERRIDE"
            hidden={{ organizationId, kind: "limit" }}
            fields={
              <>
                <input type="hidden" name="kind" value="limit" />
                <label className="block text-sm font-semibold">
                  Limit key
                  <select
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                    name="key"
                  >
                    <option value="maxWebsites">maxWebsites</option>
                    <option value="maxMonitors">maxMonitors</option>
                    <option value="maxFormMonitors">maxFormMonitors</option>
                    <option value="maxOrganizationMembers">
                      maxOrganizationMembers
                    </option>
                    <option value="maxGoogleAdsCustomers">
                      maxGoogleAdsCustomers
                    </option>
                    <option value="maxOutcomeIntegrations">
                      maxOutcomeIntegrations
                    </option>
                  </select>
                </label>
                <label className="block text-sm font-semibold">
                  Integer value
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                    name="integerValue"
                    type="number"
                    min={0}
                    required
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Expires
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                    name="expiresAt"
                    type="date"
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
            submitLabel="Create override"
          />
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Support cannot create entitlement overrides.
        </p>
      )}
    </section>
  );
}

async function IntegrationsTab({
  organizationId,
  exactRevenue,
}: {
  organizationId: string;
  exactRevenue: boolean;
}) {
  const [integrations, conversions] = await Promise.all([
    getOrganizationIntegrations(organizationId),
    listConversionExportsForOrganization(organizationId, exactRevenue),
  ]);
  return (
    <section className="mt-6 space-y-4 text-sm">
      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold">Google Ads</h2>
        <p>Connected: {integrations.googleAds?.status ?? "none"}</p>
        <p>Data Manager: {integrations.googleAds?.dataManagerStatus ?? "—"}</p>
        <p>Customers: {integrations.googleAds?._count.customers ?? 0}</p>
        {integrations.googleAds?.status === "REAUTH_REQUIRED" ? (
          <p className="font-semibold text-amber-900">
            Customer reauthorization required
          </p>
        ) : null}
        <p>Account: {integrations.googleAds?.googleAccountEmail ?? "—"}</p>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold">Conversion feedback</h2>
        <pre className="mt-2 whitespace-pre-wrap">
          {JSON.stringify(integrations.conversion, null, 2)}
        </pre>
        <ul className="mt-3 space-y-1">
          {conversions.map((row) => (
            <li key={row.id}>
              {row.publicLeadId} · {row.status} · {row.action} ·{" "}
              {row.identifierTypes} · {row.value ?? "no value"}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold">Outcome ingestion</h2>
        <pre className="mt-2 whitespace-pre-wrap">
          {JSON.stringify(integrations.outcomes, null, 2)}
        </pre>
        <p>Unmatched: {integrations.unmatched}</p>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold">Tracking / receipts</h2>
        <p>Tracking enabled websites: {integrations.trackingEnabled}</p>
        <pre className="mt-2 whitespace-pre-wrap">
          {JSON.stringify(integrations.receipts, null, 2)}
        </pre>
      </div>
    </section>
  );
}

async function RevenueTab({
  organizationId,
  exactRevenue,
}: {
  organizationId: string;
  exactRevenue: boolean;
}) {
  const summary = await getOrganizationRevenueSummary(
    organizationId,
    exactRevenue,
  );
  return (
    <section className="mt-6 space-y-3 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
      <p>Leads: {summary.leads}</p>
      <p>Won: {summary.won}</p>
      <h2 className="font-semibold">Known revenue by currency</h2>
      {summary.revenue.length === 0 ? (
        <p>No known revenue</p>
      ) : (
        summary.revenue.map((row) => (
          <p key={row.currency}>
            {row.currency}: {row.count} won
            {exactRevenue && row.amount != null
              ? ` · ${formatMoney(row.amount, row.currency ?? "EUR")}`
              : ""}
          </p>
        ))
      )}
      <h2 className="font-semibold">Google spend by currency</h2>
      {summary.spend.map((row) => (
        <p key={row.currency}>
          {row.currency}:{" "}
          {exactRevenue && row.costMicros != null
            ? String(row.costMicros)
            : "hidden"}
        </p>
      ))}
      <h2 className="font-semibold">Analytics freshness</h2>
      {summary.analytics.map((row) => (
        <p key={row.website}>
          {row.website}: {row.health} ({row.status})
        </p>
      ))}
    </section>
  );
}

async function OperationsOrgTab({
  organizationId,
}: {
  organizationId: string;
}) {
  const events = await listBillingProviderEvents(organizationId);
  return (
    <section className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
      <p>
        Failed billing events:{" "}
        {events.filter((event) => event.status === "FAILED").length}
      </p>
      <p className="mt-2 text-[var(--muted)]">
        Queue and worker health are on the global Operations page.
      </p>
    </section>
  );
}

async function AuditTab({ organizationId }: { organizationId: string }) {
  const audit = await listPlatformAudit({ organizationId });
  return (
    <section className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
      {audit.rows.length === 0 ? (
        <p>No audit events</p>
      ) : (
        <ul>
          {audit.rows.map((row) => (
            <li key={row.id}>
              {row.createdAt.toISOString()} · {row.action} · {row.reason ?? ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
