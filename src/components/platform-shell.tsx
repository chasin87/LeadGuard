import Link from "next/link";
import { Logo } from "@/components/logo";
import { LogoutButton } from "@/components/logout-button";
import type { PlatformRole } from "@/generated/prisma/enums";

const links = [
  { href: "/platform-admin", label: "Overview" },
  { href: "/platform-admin/organizations", label: "Organizations" },
  { href: "/platform-admin/users", label: "Users" },
  { href: "/platform-admin/billing", label: "Billing" },
  { href: "/platform-admin/monitoring", label: "Monitoring" },
  { href: "/platform-admin/incidents", label: "Incidents" },
  { href: "/platform-admin/integrations", label: "Integrations" },
  { href: "/platform-admin/revenue", label: "Revenue" },
  { href: "/platform-admin/operations", label: "Operations" },
  { href: "/platform-admin/audit", label: "Audit" },
];

export function PlatformShell({
  role,
  email,
  children,
}: {
  role: PlatformRole;
  email: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="border-b border-[var(--border)] bg-white lg:border-r lg:border-b-0">
        <div className="flex h-14 items-center px-4">
          <Logo href="/platform-admin" />
        </div>
        <p className="px-4 pb-3 text-xs text-[var(--muted)]">
          Platform admin · {role}
        </p>
        <nav
          className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-0.5"
          aria-label="Platform"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-slate-50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="px-4 pb-4">
          <p className="truncate text-xs text-[var(--muted)]">{email}</p>
          <LogoutButton className="mt-2 text-sm font-semibold text-slate-700">
            Sign out
          </LogoutButton>
        </div>
      </aside>
      <main className="px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}
