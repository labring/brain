import BillingTabShell from "@/features/billing/billing-tab-shell";
import { BillingEscalationDialog } from "@/features/billing-escalation/billing-escalation-dialog";
import { SessionBootstrap } from "@/features/session/session-bootstrap";
import {
  AppShellChrome,
  AppShellSidebar,
  AppShellView,
} from "@/features/shell/app-shell";
import { AppSidebarCookieBridge } from "@/features/shell/app-sidebar-cookie-bridge";
import { StatusHintBanner } from "@/features/status-hint/status-hint-banner";

/** The Brain Session is established on the client from the shared login cookie (ADR-0083). */
export const dynamic = "force-dynamic";

export default function BillingLayout({
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
          <BillingEscalationDialog />
          <BillingTabShell>{children}</BillingTabShell>
        </AppShellView>
      </AppSidebarCookieBridge>
    </AppShellChrome>
  );
}
