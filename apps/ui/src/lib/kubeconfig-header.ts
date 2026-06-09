export function headerSafeEncodedKubeconfig(kubeconfig: string): string {
  const trimmed = kubeconfig.trim();
  if (trimmed === "") {
    return "";
  }
  try {
    return encodeURIComponent(decodeURIComponent(trimmed));
  } catch {
    return encodeURIComponent(trimmed);
  }
}

export function kubeconfigBearerHeader(kubeconfig: string): string {
  return `Bearer ${headerSafeEncodedKubeconfig(kubeconfig)}`;
}
