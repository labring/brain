"use client";

import {
  type ContainerNetwork,
  ContainerPublicAddressesSettingsPane,
} from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import { Network } from "lucide-react";
import { memo } from "react";
import { verifyCustomDomainCnameFromApi } from "@/features/project-canvas/custom-domain-cname-client";
import { k8sGetClaimBody } from "@/features/project-canvas/k8s/claim-mapper";
import type { CanvasEntrySelectionRef } from "@/features/project-canvas/nodes/entry-node-selection";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { CanvasResourcePane } from "./canvas-resource-pane";
import type { SettingsLeaveGuardRegistration } from "./settings-leave-guard";
import { useWorkloadClaimSettings } from "./use-workload-claim-settings";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function draftRoutingDomainFromClaim(
  claim: Record<string, unknown> | undefined,
  kubeconfig: string
): string {
  const metadata = asRecord(claim?.metadata);
  const labels = asRecord(metadata?.labels);
  const claimRoutingDomain =
    typeof labels?.region === "string" ? labels.region.trim() : "";
  return claimRoutingDomain || routingDomainFromKubeconfig(kubeconfig);
}

function publicAddressNetworkOrNull(
  network: ContainerNetwork | undefined
): ContainerNetwork | null {
  return network ?? null;
}

export const EntryPointSettingsPane = memo(function EntryPointSettingsPane({
  kubeconfig = "",
  onClose,
  onSettingsLeaveGuardChange,
  onUpdated,
  readOnly = false,
  selection,
}: {
  kubeconfig?: string;
  onClose: () => void;
  onSettingsLeaveGuardChange?: SettingsLeaveGuardRegistration;
  onUpdated?: () => Promise<unknown>;
  readOnly?: boolean;
  selection: CanvasEntrySelectionRef;
}) {
  const { claimPayload, display, error, isLoading, onNetworkDraftCommit } =
    useWorkloadClaimSettings({
      kubeconfig,
      name: selection.apName,
      namespace: selection.namespace,
      onWorkloadMutation: onUpdated,
      readOnly,
      workloadKind: "AP",
    });
  const title = `${selection.apName} Public Addresses`;
  const subtitle = `EntryPoint · ${selection.namespace}`;
  const claim = k8sGetClaimBody(claimPayload);
  const draftRoutingDomain = draftRoutingDomainFromClaim(claim, kubeconfig);
  const network = publicAddressNetworkOrNull(display.network);
  const canEdit = !readOnly;

  return (
    <CanvasResourcePane
      closeAriaLabel="Close EntryPoint settings"
      icon={<Network aria-hidden className="size-4 shrink-0 text-blue-500" />}
      onClose={onClose}
      subtitle={subtitle}
      title={title}
    >
      {error == null ? null : (
        <p className="text-destructive text-sm" role="alert">
          Could not load AP public addresses: {error.message}
        </p>
      )}
      {error == null && isLoading && network == null ? (
        <p className="text-resource-pane-muted text-sm">
          Loading public addresses…
        </p>
      ) : null}
      {error == null && !isLoading && network == null ? (
        <p className="text-resource-pane-muted text-sm">
          Public Address settings are unavailable.
        </p>
      ) : null}
      {error == null && network != null ? (
        <ContainerPublicAddressesSettingsPane
          identityKey={`${selection.namespace}/${selection.apName}`}
          network={network}
          networkPlatformAddressDraftContext={{
            appName: selection.apName,
            namespace: selection.namespace,
            routingDomain: draftRoutingDomain,
          }}
          onCustomDomainCnameVerify={
            canEdit ? verifyCustomDomainCnameFromApi : undefined
          }
          onNetworkDraftCommit={canEdit ? onNetworkDraftCommit : undefined}
          onSettingsDraftLeaveGuardChange={onSettingsLeaveGuardChange}
          readOnly={readOnly}
        />
      ) : null}
    </CanvasResourcePane>
  );
});

EntryPointSettingsPane.displayName = "EntryPointSettingsPane";
