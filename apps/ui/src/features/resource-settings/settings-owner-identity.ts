import type { SettingsOwnerTarget } from "@/features/panes/target-identity";
import type { PendingSettingsOwnerIdentity } from "./pending-settings-updates";

function stableClusterFingerprint(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2_147_483_647;
  }
  return `stable:${hash.toString(36).padStart(7, "0")}`;
}

function settingsOwnerKind(
  target: SettingsOwnerTarget
): PendingSettingsOwnerIdentity["kind"] {
  return target.kind === "AP" ? "ap" : "database";
}

export function settingsOwnerIdentity({
  kubeconfig,
  target,
}: {
  kubeconfig?: string;
  target: SettingsOwnerTarget | null;
}): PendingSettingsOwnerIdentity | undefined {
  if (target == null) {
    return undefined;
  }
  const observedUid = target.observedUid?.trim();
  return {
    clusterFingerprint: stableClusterFingerprint(kubeconfig?.trim() ?? ""),
    kind: settingsOwnerKind(target),
    name: target.name,
    namespace: target.namespace,
    ...(observedUid == null || observedUid === "" ? {} : { uid: observedUid }),
  };
}
