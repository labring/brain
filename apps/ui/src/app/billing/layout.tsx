import BillingTabShell from "@/features/billing/billing-tab-shell";
import {
  AppShellChrome,
  AppShellSidebar,
  AppShellView,
} from "@/features/shell/app-shell";
import AuthBootstrap, {
  SealosSdkBootstrap,
} from "@/features/shell/auth-bootstrap";

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
      <AppShellSidebar />
      <AppShellView className="min-w-0 flex-1 basis-0">
        <BillingTabShell>{children}</BillingTabShell>
      </AppShellView>
    </AppShellChrome>
  );
}
