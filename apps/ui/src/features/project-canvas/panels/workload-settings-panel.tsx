"use client";

import { ContainerSettingsPane } from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { Settings2 } from "lucide-react";
import { memo } from "react";
import { WORKLOAD_PANEL_REPLICAS } from "@/features/project-canvas/canvas-store";
import { verifyCustomDomainCnameFromApi } from "@/features/project-canvas/custom-domain-cname-client";
import {
  containerStatesFromNode,
  workloadClaimKindFromStates,
} from "@/features/project-canvas/flow/container-node-workload";
import { k8sGetClaimBody } from "@/features/project-canvas/k8s/claim-mapper";
import type { CanvasContainerNodeData } from "@/features/project-canvas/nodes/types";
import { useWorkloadClaimSettings } from "@/features/project-canvas/panels/use-workload-claim-settings";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import {
  CanvasResourcePane,
  type CanvasResourcePaneProps,
} from "./canvas-resource-pane";
import type { SettingsLeaveGuardRegistration } from "./settings-leave-guard";

function workloadSettingsSubtitle({
  image,
  kind,
}: {
  image: string | undefined;
  kind: string;
}) {
  const imageValue = image?.trim() ?? "";
  return imageValue === "" ? kind : `${kind} · ${imageValue}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function draftRoutingDomainFromResource(
  resource: Record<string, unknown> | undefined,
  kubeconfig: string
): string {
  const metadata = asRecord(resource?.metadata);
  const labels = asRecord(metadata?.labels);
  const resourceRoutingDomain =
    typeof labels?.region === "string" ? labels.region.trim() : "";
  return resourceRoutingDomain || routingDomainFromKubeconfig(kubeconfig);
}

type WorkloadSettingsShellProps = Pick<
  CanvasResourcePaneProps,
  "children" | "onClose" | "subtitle" | "title"
>;

function WorkloadSettingsShell({
  children,
  onClose,
  subtitle,
  title,
}: WorkloadSettingsShellProps) {
  return (
    <CanvasResourcePane
      closeAriaLabel="Close workload settings"
      icon={<Settings2 aria-hidden className="size-4 shrink-0 text-blue-400" />}
      onClose={onClose}
      subtitle={subtitle}
      title={title}
    >
      {children}
    </CanvasResourcePane>
  );
}

export const WorkloadSettingsPane = memo(function WorkloadSettingsPane({
  focus = "all",
  node,
  onClose,
  onSettingsLeaveGuardChange,
}: {
  focus?: "all" | "environment";
  node: Node;
  onClose: () => void;
  onSettingsLeaveGuardChange?: SettingsLeaveGuardRegistration;
}) {
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespaceFallback = useAtomValue(namespaceAtom).trim();

  const states = containerStatesFromNode(node);
  const data =
    node.data != null && typeof node.data === "object"
      ? (node.data as CanvasContainerNodeData)
      : undefined;
  const name = states?.name ?? "";
  const ns = states?.namespace?.trim() || namespaceFallback;
  const workloadKind = workloadClaimKindFromStates(states);
  const settingsReadOnly = data?.settingsAccess?.readOnly === true;
  const canEditAp = workloadKind === "AP" && !settingsReadOnly;
  const title = name === "" ? "Workload Settings" : name;
  const subtitle = workloadSettingsSubtitle({
    image: states?.image,
    kind: workloadKind,
  });

  const {
    display,
    error,
    ignoreEnv,
    ignoreImage,
    ignoreNetwork,
    ignoreQuota,
    ignoreReplicas,
    isApWorkload,
    isLoading,
    onEnvChange,
    onImageChange,
    onEnvResolvedValue,
    onNetworkChange,
    onResourceQuotasCommit,
    onSettingsDraftCommit,
    claimPayload,
  } = useWorkloadClaimSettings({
    dbDsnReferenceSources: data?.dbDsnReferenceSources,
    kubeconfig,
    name,
    namespace: ns,
    onAddDbDsnReferenceMutationStart: data?.onAddDbDsnReferenceMutationStart,
    onWorkloadMutation: data?.onWorkloadMutation,
    readOnly: settingsReadOnly,
    workloadKind,
  });
  const resource = k8sGetClaimBody(claimPayload);
  const draftRoutingDomain = draftRoutingDomainFromResource(
    resource,
    kubeconfig
  );

  if (ns === "" || name === "") {
    return (
      <WorkloadSettingsShell
        onClose={onClose}
        subtitle={subtitle}
        title={title}
      >
        <p className="text-muted-foreground text-sm">
          Select a workload with a name and configure namespace in settings.
        </p>
      </WorkloadSettingsShell>
    );
  }

  if (error != null) {
    return (
      <WorkloadSettingsShell
        onClose={onClose}
        subtitle={subtitle}
        title={title}
      >
        <p className="text-destructive text-sm" role="alert">
          Could not load workload: {error.message}
        </p>
      </WorkloadSettingsShell>
    );
  }

  if (isLoading && resource == null) {
    return (
      <WorkloadSettingsShell
        onClose={onClose}
        subtitle={subtitle}
        title={title}
      >
        <p className="text-muted-foreground text-sm">Loading workload…</p>
      </WorkloadSettingsShell>
    );
  }

  return (
    <WorkloadSettingsShell onClose={onClose} subtitle={subtitle} title={title}>
      <ContainerSettingsPane
        addDbDsnReferenceIntent={data?.addDbDsnReferenceIntent}
        className="gap-5"
        cpuQuota={{
          max: 8,
          min: 0.25,
          onValueChange: ignoreQuota,
          step: 0.25,
          value: display.cpuCores,
        }}
        dbDsnReferenceSources={data?.dbDsnReferenceSources}
        env={display.env}
        envRawSource={display.envRawSource}
        envResolvedValueScope={`${ns}/${name}`}
        image={display.image}
        memoryQuota={{
          max: 16_384,
          min: 512,
          onValueChange: ignoreQuota,
          step: 128,
          value: display.memoryMib,
        }}
        network={display.network}
        networkPlatformAddressDraftContext={{
          appName: name,
          namespace: ns,
          routingDomain: draftRoutingDomain,
        }}
        onAddDbDsnReferenceIntentConsumed={
          data?.onAddDbDsnReferenceIntentConsumed
        }
        onAddDbDsnReferenceIntentDraftChange={
          data?.onAddDbDsnReferenceIntentDraftChange
        }
        onCustomDomainCnameVerify={verifyCustomDomainCnameFromApi}
        onEnvChange={canEditAp ? onEnvChange : ignoreEnv}
        onEnvResolvedValue={canEditAp ? onEnvResolvedValue : undefined}
        onImageChange={canEditAp ? onImageChange : ignoreImage}
        onNetworkChange={canEditAp ? onNetworkChange : ignoreNetwork}
        onResourceQuotasCommit={canEditAp ? onResourceQuotasCommit : undefined}
        onSettingsDraftCommit={canEditAp ? onSettingsDraftCommit : undefined}
        onSettingsDraftLeaveGuardChange={onSettingsLeaveGuardChange}
        readOnly={!isApWorkload || settingsReadOnly}
        replicaStrategy={display.replicaStrategy}
        replicasQuota={
          isApWorkload
            ? {
                ...WORKLOAD_PANEL_REPLICAS,
                disabled: !canEditAp,
                onValueChange: ignoreReplicas,
                step: 1,
                value: display.replicas,
              }
            : undefined
        }
        sectionFocus={focus}
        showImageSection={false}
      />
    </WorkloadSettingsShell>
  );
});

WorkloadSettingsPane.displayName = "WorkloadSettingsPane";
