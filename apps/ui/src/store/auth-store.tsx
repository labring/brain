import { atom } from "jotai";
import { namespaceFromKubeconfigText } from "@/lib/chat-runtime/kubeconfig-namespace-core";

function devKubeconfigFromEnv(): string {
  try {
    return decodeURIComponent(
      process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG ?? ""
    );
  } catch {
    return process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG ?? "";
  }
}

const devKubeconfig = devKubeconfigFromEnv();

export const kubeconfigAtom = atom(devKubeconfig);

export const namespaceAtom = atom(
  namespaceFromKubeconfigText(devKubeconfig) ?? ""
);

export const desktopLanguageAtom = atom("en");
