import Link from "next/link";
import { notFound } from "next/navigation";
import { WebsiteDeleteForm } from "@/components/website-delete-form";
import { WebsiteSettingsForm } from "@/components/website-settings-form";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { WebsiteNotFoundError } from "@/server/security/errors";
import { getWebsite } from "@/server/websites/service";

export const metadata = { title: "Website settings" };

export default async function WebsiteSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; websiteId: string }>;
}) {
  const { organizationSlug, websiteId } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") {
    return null;
  }

  let website;
  try {
    website = await getWebsite(user.id, organizationSlug, websiteId);
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) {
      notFound();
    }
    throw error;
  }

  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "websites:manage",
  );
  const detailHref = `/app/${organizationSlug}/websites/${website.id}`;

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={detailHref}
        >
          {website.name}
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Settings</h1>
      <p className="mt-2 max-w-xl text-[var(--muted)]">
        Changing the URL runs the same validation as adding a website.
      </p>

      {canManage ? (
        <>
          <section className="mt-8 max-w-xl rounded-2xl border border-[var(--border)] bg-white p-6">
            <WebsiteSettingsForm
              organizationSlug={organizationSlug}
              websiteId={website.id}
              name={website.name}
              url={website.normalizedUrl}
              status={website.status}
            />
          </section>
          <section className="mt-8 max-w-xl rounded-2xl border border-red-200 bg-white p-6">
            <h2 className="text-lg font-bold">Delete website</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
              This permanently removes the website from the organization. Future
              monitors and history will need an archive strategy; this phase
              uses a hard delete because no check history exists yet.
            </p>
            <div className="mt-5">
              <WebsiteDeleteForm
                organizationSlug={organizationSlug}
                websiteId={website.id}
                name={website.name}
              />
            </div>
          </section>
        </>
      ) : (
        <p className="mt-8 text-sm text-[var(--muted)]">
          Only owners and admins can change website settings.
        </p>
      )}
    </div>
  );
}
