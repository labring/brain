const EMPTY_KUBECONFIG_CREDENTIAL_KEY = "kubeconfig:empty";

/** Percent-encodes kubeconfig text that is known to be raw YAML. */
export function encodeRawKubeconfig(kubeconfig: string): string {
  return kubeconfig.trim() === "" ? "" : encodeURIComponent(kubeconfig);
}

function normalizeKubeconfig(kubeconfig: string): string {
  const trimmed = kubeconfig.trim();
  if (trimmed === "") {
    return "";
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function hashCredentialMaterial(input: string): string {
  const firstMod = 2_147_483_647;
  const secondMod = 2_147_483_629;
  let first = input.length + 1;
  let second = input.length + 7;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = (first * 48_271 + code + index) % firstMod;
    second = (second * 69_621 + code + index) % secondMod;
  }

  return `${first.toString(36)}${second.toString(36)}`;
}

export function headerSafeEncodedKubeconfig(kubeconfig: string): string {
  const normalized = normalizeKubeconfig(kubeconfig);
  return normalized === "" ? "" : encodeURIComponent(normalized);
}

export function kubeconfigBearerHeader(kubeconfig: string): string {
  return `Bearer ${headerSafeEncodedKubeconfig(kubeconfig)}`;
}

export function kubeconfigAuthHeader(
  kubeconfig: string
): Record<string, string> {
  return { Authorization: kubeconfigBearerHeader(kubeconfig) };
}

export function kubeconfigCredentialKey(kubeconfig?: string): string {
  const normalized = normalizeKubeconfig(kubeconfig ?? "");
  if (normalized === "") {
    return EMPTY_KUBECONFIG_CREDENTIAL_KEY;
  }
  return `kubeconfig:${normalized.length}:${hashCredentialMaterial(normalized)}`;
}
