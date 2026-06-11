import type { ContainerNodeStates } from "@workspace/ui/components/container-node/container-node";
import type { WorkloadClaimKind } from "@/features/project-settings/ap/k8s/claim-mapper";

export function workloadClaimKindFromApSettingsStates(
  states: ContainerNodeStates | null
): WorkloadClaimKind {
  return states?.kind?.trim().toUpperCase() === "DB" ? "DB" : "AP";
}
