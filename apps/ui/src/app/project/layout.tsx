import { OnboardingGate } from "@/features/onboarding/onboarding-gate";
import { ProjectsExplorerDevMockGate } from "@/features/projects/explorer/projects-dev-mock-gate";
import {
  AppShellChrome,
  AppShellSidebar,
  AppShellView,
} from "@/features/shell/app-shell";
import { AppSidebarCookieBridge } from "@/features/shell/app-sidebar-cookie-bridge";
import AuthBootstrap, {
  DevboxBootstrap,
  SealosSdkBootstrap,
} from "@/features/shell/auth-bootstrap";
import ProjectWorkspaceLayout from "@/features/shell/project-workspace-layout";
import { StatusHintBanner } from "@/features/status-hint/status-hint-banner";

/** Desktop iframe auth is resolved on the client through the Sealos SDK. */
export const dynamic = "force-dynamic";

export default function ProjectLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AppShellChrome>
      <AuthBootstrap serverEncodedKubeconfig="" serverNamespace="" />
      <SealosSdkBootstrap />
      <DevboxBootstrap />
      <OnboardingGate />
      <ProjectsExplorerDevMockGate />
      <AppSidebarCookieBridge>
        <AppShellSidebar />
        <AppShellView className="min-w-0 flex-1 basis-0">
          <StatusHintBanner />
          <ProjectWorkspaceLayout>{children}</ProjectWorkspaceLayout>
        </AppShellView>
      </AppSidebarCookieBridge>
    </AppShellChrome>
  );
}
