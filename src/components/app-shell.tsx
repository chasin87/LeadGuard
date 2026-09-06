import Link from "next/link";
import type { OrganizationRole } from "@/generated/prisma/enums";
import { Logo } from "@/components/logo";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { LogoutButton } from "@/components/logout-button";

export function AppShell({
  organization,
  role,
  memberships,
  openIncidentCount,
  children,
}: {
  organization: { name: string; slug: string };
  role: OrganizationRole;
  memberships: Array<{ name: string; slug: string; role: OrganizationRole }>;
  openIncidentCount: number;
  children: React.ReactNode;
}) {
  const base = `/app/${organization.slug}`;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-[var(--border)] bg-white lg:border-r lg:border-b-0">
        <div className="flex h-16 items-center px-5">
          <Logo href={`${base}/dashboard`} />
        </div>
        <div className="px-4 pb-4">
          <OrganizationSwitcher
            current={{ ...organization, role }}
            memberships={memberships}
          />
        </div>
        <nav
          className="flex gap-1 px-4 pb-4 lg:block lg:space-y-1"
          aria-label="Appnavigatie"
        >
          <Link
            className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            href={`${base}/dashboard`}
          >
            Dashboard
          </Link>
          <Link
            className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            href={`${base}/websites`}
          >
            Websites
          </Link>
          <Link
            className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            href={`${base}/incidents`}
          >
            Incidents
            {openIncidentCount > 0 ? (
              <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">
                {openIncidentCount}
              </span>
            ) : null}
          </Link>
          <Link
            className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            href={`${base}/attribution`}
          >
            Attribution
          </Link>
          <Link
            className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            data-testid="nav-analytics"
            href={`${base}/analytics/revenue`}
          >
            Analytics
          </Link>
          <Link
            className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            data-testid="nav-integrations"
            href={`${base}/integrations`}
          >
            Integrations
          </Link>
          <Link
            className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            data-testid="nav-settings"
            href={`${base}/settings`}
          >
            Settings
          </Link>
          <Link
            className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            data-testid="nav-billing"
            href={`${base}/settings/billing`}
          >
            Billing
          </Link>
        </nav>
        <div className="px-4 pb-6">
          <LogoutButton className="text-sm font-semibold text-[var(--muted)] hover:text-slate-950">
            Uitloggen
          </LogoutButton>
        </div>
      </aside>
      <div>{children}</div>
    </div>
  );
}
