import {
  AppShellChrome,
  AppShellSidebar,
  AppShellView,
} from "@/features/shell/app-shell";
import AuthBootstrap, {
  SealosSdkBootstrap,
} from "@/features/shell/auth-bootstrap";
import ProjectWorkspaceLayout from "@/features/shell/project-workspace-layout";

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
      <AppShellSidebar />
      <AppShellView className="min-w-0 flex-1 basis-0">
        <ProjectWorkspaceLayout>{children}</ProjectWorkspaceLayout>
      </AppShellView>
    </AppShellChrome>
  );
}
