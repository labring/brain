import { BillingDevMockGate } from "@/features/billing/billing-dev-mock-gate";
import BillingTabShell from "@/features/billing/billing-tab-shell";
import {
  AppShellChrome,
  AppShellSidebar,
  AppShellView,
} from "@/features/shell/app-shell";
import { AppSidebarCookieBridge } from "@/features/shell/app-sidebar-cookie-bridge";
import AuthBootstrap, {
  SealosSdkBootstrap,
} from "@/features/shell/auth-bootstrap";
import { StatusHintBanner } from "@/features/status-hint/status-hint-banner";

/** Desktop iframe auth is resolved on the client through the Sealos SDK. */
export const dynamic = "force-dynamic";

export default function BillingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AppShellChrome>
      <AuthBootstrap serverEncodedKubeconfig="" serverNamespace="" />
      <SealosSdkBootstrap />
      <BillingDevMockGate />
      <AppSidebarCookieBridge>
        <AppShellSidebar />
        <AppShellView className="min-w-0 flex-1 basis-0">
          <StatusHintBanner />
          <BillingTabShell>{children}</BillingTabShell>
        </AppShellView>
      </AppSidebarCookieBridge>
    </AppShellChrome>
  );
}
