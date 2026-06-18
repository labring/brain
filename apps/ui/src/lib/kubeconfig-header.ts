import {
  headerSafeEncodedKubeconfig as sharedHeaderSafeEncodedKubeconfig,
  kubeconfigBearerHeader as sharedKubeconfigBearerHeader,
} from "@workspace/api/credential-key";

export function headerSafeEncodedKubeconfig(kubeconfig: string): string {
  return sharedHeaderSafeEncodedKubeconfig(kubeconfig);
}

export function kubeconfigBearerHeader(kubeconfig: string): string {
  return sharedKubeconfigBearerHeader(kubeconfig);
}
