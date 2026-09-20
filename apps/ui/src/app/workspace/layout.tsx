import { SessionBootstrap } from "@/features/session/session-bootstrap";
import {
  AppShellChrome,
  AppShellSidebar,
  AppShellView,
} from "@/features/shell/app-shell";
import { AppSidebarCookieBridge } from "@/features/shell/app-sidebar-cookie-bridge";
import { StatusHintBanner } from "@/features/status-hint/status-hint-banner";
import { WorkspaceArea } from "@/features/workspace/workspace-area";

/** The Brain Session is established on the client from the shared login cookie (ADR-0083). */
export const dynamic = "force-dynamic";

/**
 * The Workspace Area's frame (spec §D): the area itself lives here so the
 * list stays mounted while the Managed Workspace changes; the pages below
 * only name the uid in the URL, which the area reads.
 */
export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AppShellChrome>
      <SessionBootstrap />
      <AppSidebarCookieBridge>
        <AppShellSidebar />
        <AppShellView className="min-w-0 flex-1 basis-0">
          <StatusHintBanner />
          <WorkspaceArea />
          {children}
        </AppShellView>
      </AppSidebarCookieBridge>
    </AppShellChrome>
  );
}
