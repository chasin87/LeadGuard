import { requireUser } from "@/server/authorization/session";

export const dynamic = "force-dynamic";

export default async function AppRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return children;
}
