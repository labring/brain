import { atom } from "jotai";
import { namespaceFromKubeconfigText } from "@/lib/kubeconfig-namespace-core";

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

/**
 * Desktop-minted App Token for personal-resource requests (ADR-0059).
 * Hydrated from the Desktop SDK session; the dev override pairs with
 * `NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG` (mint via `scripts/mint-dev-app-token.mjs`).
 */
export const appTokenAtom = atom(
  process.env.NEXT_PUBLIC_DEV_APP_TOKEN?.trim() ?? ""
);

export const desktopUserIdAtom = atom("");

export const desktopLanguageAtom = atom("en");
