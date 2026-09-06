import Link from "next/link";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { listBillingProviderEvents } from "@/server/platform-admin/health";
import { database } from "@/server/database";

export const metadata = { title: "Platform billing" };

export default async function PlatformBillingPage() {
  await requirePlatformPermission("platform:billing:read");
  const [groups, events] = await Promise.all([
    database.billingSubscription.groupBy({
      by: ["planKey", "status"],
      _count: { _all: true },
    }),
    listBillingProviderEvents(),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold">Billing</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Stripe IDs are visible. Secrets and card data are not.
      </p>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        {groups.map((row) => (
          <p key={`${row.planKey}-${row.status}`}>
            {row.planKey} · {row.status}: {row._count._all}
          </p>
        ))}
      </section>
      <h2 className="mt-6 font-semibold">Recent provider events</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-[var(--muted)]">No failed provider events</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {events.map((event) => (
            <li key={event.id}>
              {event.type} · {event.status} · {event.errorCode ?? "ok"}
              {event.organizationId ? (
                <>
                  {" "}
                  <Link
                    href={`/platform-admin/organizations/${event.organizationId}?tab=billing`}
                  >
                    org
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
