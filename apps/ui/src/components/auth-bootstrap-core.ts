import { namespaceFromKubeconfigText } from "@/lib/chat-runtime/kubeconfig-namespace-core";

export function applySealosSdkHydration(input: {
  language: { lng: string } | null;
  session: { kubeconfig: string } | null;
  setDesktopLanguage: (language: string) => void;
  setKubeconfig: (kubeconfig: string) => void;
  setNamespace: (namespace: string) => void;
}) {
  if (input.language !== null) {
    input.setDesktopLanguage(input.language.lng.trim() || "en");
  }

  const kubeconfig = input.session?.kubeconfig.trim() ?? "";
  if (kubeconfig === "") {
    return;
  }
  input.setKubeconfig(kubeconfig);
  input.setNamespace(namespaceFromKubeconfigText(kubeconfig) ?? "");
}
