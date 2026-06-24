import type { SettingsOwnerTarget } from "@/features/project-surfaces/target-identity";

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value.trim());
}

function checkpointTargetKind(target: SettingsOwnerTarget): string {
  return target.kind === "AP" ? "ap" : "database";
}

function stableFingerprint(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2_147_483_647;
  }
  return hash.toString(36).padStart(7, "0");
}

export function settingsSubmitCheckpointKey({
  kubeconfig,
  target,
}: {
  kubeconfig?: string;
  target: SettingsOwnerTarget | null;
}): string | undefined {
  if (target == null) {
    return undefined;
  }
  const clusterFingerprint = stableFingerprint(kubeconfig?.trim() ?? "");
  const observedUid = target.observedUid?.trim() ?? "";
  return [
    checkpointTargetKind(target),
    `cluster:${clusterFingerprint}`,
    `namespace:${encodeKeyPart(target.namespace)}`,
    `name:${encodeKeyPart(target.name)}`,
    observedUid === "" ? "uid:" : `uid:${encodeKeyPart(observedUid)}`,
  ].join(":");
}
