import {
  AppShellChrome,
  AppShellSidebar,
  AppShellView,
} from "@/components/app-shell";
import AuthBootstrap, {
  DevboxBootstrap,
  SealosSdkBootstrap,
} from "@/components/auth-bootstrap";
import ProjectWorkspaceLayout from "@/components/project-workspace-layout";

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
      <AppShellSidebar />
      <AppShellView className="min-w-0 flex-1 basis-0">
        <ProjectWorkspaceLayout>{children}</ProjectWorkspaceLayout>
      </AppShellView>
    </AppShellChrome>
  );
}
