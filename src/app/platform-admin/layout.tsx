import { PlatformAccessDenied } from "@/components/platform-access-denied";
import { PlatformShell } from "@/components/platform-shell";
import { loadPlatformAccess } from "@/server/platform-admin/access";
import { requireUser } from "@/server/authorization/session";

export const dynamic = "force-dynamic";

export default async function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const access = await loadPlatformAccess(user.id);
  if (!access) {
    return <PlatformAccessDenied />;
  }
  return (
    <PlatformShell role={access.role} email={access.email}>
      {children}
    </PlatformShell>
  );
}
