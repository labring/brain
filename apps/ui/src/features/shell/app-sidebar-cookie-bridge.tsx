import { SIDEBAR_COOKIE_NAME } from "@workspace/ui/lib/sidebar-cookie";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppSidebarShell } from "@/features/shell/app-sidebar";

export async function AppSidebarCookieBridge({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return (
    <AppSidebarShell defaultOpen={defaultOpen}>{children}</AppSidebarShell>
  );
}
