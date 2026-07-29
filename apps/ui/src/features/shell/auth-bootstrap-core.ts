import { namespaceFromKubeconfigText } from "@/lib/kubeconfig-namespace-core";

export function applySealosSdkHydration(input: {
  language: { lng: string } | null;
  session: {
    kubeconfig: string;
    token?: string;
    user?: { id?: string };
  } | null;
  setAppToken?: (appToken: string) => void;
  setDesktopLanguage: (language: string) => void;
  setDesktopUserId: (userId: string) => void;
  setKubeconfig: (kubeconfig: string) => void;
  setNamespace: (namespace: string) => void;
}) {
  if (input.language !== null) {
    input.setDesktopLanguage(input.language.lng.trim() || "en");
  }

  // Desktop mints the app token only at login / region switch / workspace
  // switch, so an absent token must not clear a previously hydrated one.
  const appToken = input.session?.token?.trim() ?? "";
  if (appToken !== "") {
    input.setAppToken?.(appToken);
  }

  const kubeconfig = input.session?.kubeconfig.trim() ?? "";
  input.setDesktopUserId(input.session?.user?.id?.trim() ?? "");
  if (kubeconfig === "") {
    return;
  }
  input.setKubeconfig(kubeconfig);
  input.setNamespace(namespaceFromKubeconfigText(kubeconfig) ?? "");
}
