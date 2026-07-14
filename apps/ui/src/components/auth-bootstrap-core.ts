import { namespaceFromKubeconfigText } from "@/lib/kubeconfig-namespace-core";

export function applySealosSdkHydration(input: {
  language: { lng: string } | null;
  session: { kubeconfig: string; user?: { id?: string } } | null;
  setDesktopLanguage: (language: string) => void;
  setDesktopUserId: (userId: string) => void;
  setKubeconfig: (kubeconfig: string) => void;
  setNamespace: (namespace: string) => void;
}) {
  if (input.language !== null) {
    input.setDesktopLanguage(input.language.lng.trim() || "en");
  }

  const kubeconfig = input.session?.kubeconfig.trim() ?? "";
  input.setDesktopUserId(input.session?.user?.id?.trim() ?? "");
  if (kubeconfig === "") {
    return;
  }
  input.setKubeconfig(kubeconfig);
  input.setNamespace(namespaceFromKubeconfigText(kubeconfig) ?? "");
}
