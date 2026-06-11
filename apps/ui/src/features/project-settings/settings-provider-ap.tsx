"use client";

import {
  type ContainerNetwork,
  useContainerPublicAddressesSettingsSections,
  useContainerSettingsSections,
} from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import { Router, Settings2, SquarePen } from "lucide-react";
import { useEffect, useMemo } from "react";
import { WORKLOAD_PANEL_REPLICAS } from "@/features/project-canvas/canvas-store";
import { verifyCustomDomainCnameFromApi } from "@/features/project-canvas/custom-domain-cname-client";
import {
  containerStatesFromNode,
  workloadClaimKindFromStates,
} from "@/features/project-canvas/flow/container-node-workload";
import { k8sGetClaimBody } from "@/features/project-canvas/k8s/claim-mapper";
import type { CanvasContainerNodeData } from "@/features/project-canvas/nodes/types";
import { useWorkloadClaimSettings } from "@/features/project-canvas/panels/use-workload-claim-settings";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import type { ProjectApTarget } from "@/features/project-surfaces/target-identity";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { SettingsSections } from "./settings-sections";
import type {
  SettingsProviderProps,
  SettingsViewModel,
} from "./settings-types";

const AP_SETTINGS_FULL_VIEW = "full";
const AP_SETTINGS_ENVIRONMENT_VIEW = "environment";
const AP_SETTINGS_PUBLIC_ADDRESSES_VIEW = "public-addresses";

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

function resolvedApSettingsView(view: string | undefined) {
  if (view == null || view.trim() === "") {
    return AP_SETTINGS_FULL_VIEW;
  }
  if (
    view === AP_SETTINGS_FULL_VIEW ||
    view === AP_SETTINGS_ENVIRONMENT_VIEW ||
    view === AP_SETTINGS_PUBLIC_ADDRESSES_VIEW
  ) {
    return view;
  }
  return AP_SETTINGS_FULL_VIEW;
}

function apSettingsRepairEntry({
  resolvedView,
  target,
  view,
}: {
  resolvedView: string;
  target: ProjectApTarget;
  view: string | undefined;
}): ProjectSideSurfaceEntry | undefined {
  if (view == null || view.trim() === "" || view === resolvedView) {
    return undefined;
  }
  return { kind: "settings", target };
}

function publicAddressNetworkOrNull(
  network: ContainerNetwork | undefined
): ContainerNetwork | null {
  return network ?? null;
}

function apSettingsModelBase({
  resolvedView,
  subtitle,
  target,
}: {
  resolvedView: string;
  subtitle: string;
  target: ProjectApTarget;
}): Omit<SettingsViewModel, "sections"> {
  if (resolvedView === AP_SETTINGS_PUBLIC_ADDRESSES_VIEW) {
    return {
      closeAriaLabel: "Close Public Address settings",
      icon: <Router aria-hidden className="size-4 shrink-0 text-blue-400" />,
      resolvedView,
      subtitle: `AP · ${target.namespace}`,
      title: `${target.name} Public Addresses`,
    };
  }
  if (resolvedView === AP_SETTINGS_ENVIRONMENT_VIEW) {
    return {
      closeAriaLabel: "Close Environment Variable settings",
      icon: <Settings2 aria-hidden className="size-4 shrink-0 text-blue-400" />,
      resolvedView,
      subtitle,
      title: target.name === "" ? "Environment Variables" : target.name,
    };
  }
  return {
    closeAriaLabel: "Close AP settings",
    icon: <Settings2 aria-hidden className="size-4 shrink-0 text-blue-400" />,
    resolvedView,
    subtitle,
    title: target.name === "" ? "AP Settings" : target.name,
  };
}

type WorkloadClaimSettingsState = ReturnType<typeof useWorkloadClaimSettings>;

interface ApSettingsSectionsHookInput {
  apTarget: ProjectApTarget | null;
  canEditAp: boolean;
  display: WorkloadClaimSettingsState["display"];
  draftRoutingDomain: string;
  effectiveReadOnly: boolean;
  ignoreEnv: WorkloadClaimSettingsState["ignoreEnv"];
  ignoreImage: WorkloadClaimSettingsState["ignoreImage"];
  ignoreNetwork: WorkloadClaimSettingsState["ignoreNetwork"];
  ignoreQuota: WorkloadClaimSettingsState["ignoreQuota"];
  ignoreReplicas: WorkloadClaimSettingsState["ignoreReplicas"];
  isApWorkload: boolean;
  nodeData: CanvasContainerNodeData | undefined;
  onEnvChange: WorkloadClaimSettingsState["onEnvChange"];
  onEnvResolvedValue: WorkloadClaimSettingsState["onEnvResolvedValue"];
  onImageChange: WorkloadClaimSettingsState["onImageChange"];
  onNetworkChange: WorkloadClaimSettingsState["onNetworkChange"];
  onResourceQuotasCommit: WorkloadClaimSettingsState["onResourceQuotasCommit"];
  onSettingsDraftCommit: WorkloadClaimSettingsState["onSettingsDraftCommit"];
  resolvedView: string;
}

function apSettingsSectionsHookProps({
  apTarget,
  canEditAp,
  display,
  draftRoutingDomain,
  effectiveReadOnly,
  ignoreEnv,
  ignoreImage,
  ignoreNetwork,
  ignoreQuota,
  ignoreReplicas,
  isApWorkload,
  nodeData,
  onEnvChange,
  onEnvResolvedValue,
  onImageChange,
  onNetworkChange,
  onResourceQuotasCommit,
  onSettingsDraftCommit,
  resolvedView,
}: ApSettingsSectionsHookInput): Parameters<
  typeof useContainerSettingsSections
>[0] {
  const metadata = apSettingsSectionMetadata(resolvedView);
  return {
    addDbDsnReferenceIntent: nodeData?.addDbDsnReferenceIntent,
    args: display.args,
    command: display.command,
    configMaps: display.configMaps,
    cpuQuota: {
      max: 8,
      min: 0.25,
      onValueChange: ignoreQuota,
      step: 0.25,
      value: display.cpuCores,
    },
    dbDsnReferenceSources: nodeData?.dbDsnReferenceSources,
    env: display.env,
    envRawSource: display.envRawSource,
    envResolvedValueScope:
      apTarget == null ? undefined : `${apTarget.namespace}/${apTarget.name}`,
    image: display.image,
    memoryQuota: {
      max: 16_384,
      min: 512,
      onValueChange: ignoreQuota,
      step: 128,
      value: display.memoryMib,
    },
    network: display.network,
    networkPlatformAddressDraftContext:
      apTarget == null
        ? undefined
        : {
            appName: apTarget.name,
            namespace: apTarget.namespace,
            routingDomain: draftRoutingDomain,
          },
    onAddDbDsnReferenceIntentConsumed:
      nodeData?.onAddDbDsnReferenceIntentConsumed,
    onCustomDomainCnameVerify: verifyCustomDomainCnameFromApi,
    onEnvChange: canEditAp ? onEnvChange : ignoreEnv,
    onEnvResolvedValue: canEditAp ? onEnvResolvedValue : undefined,
    onImageChange: canEditAp ? onImageChange : ignoreImage,
    onNetworkChange: canEditAp ? onNetworkChange : ignoreNetwork,
    onPendingDbReferencesChange: nodeData?.onPendingDbReferencesChange,
    onResourceQuotasCommit: canEditAp ? onResourceQuotasCommit : undefined,
    onSettingsDraftCommit: canEditAp ? onSettingsDraftCommit : undefined,
    readOnly: !isApWorkload || effectiveReadOnly,
    replicaStrategy: display.replicaStrategy,
    replicasQuota: isApWorkload
      ? {
          ...WORKLOAD_PANEL_REPLICAS,
          disabled: !canEditAp,
          onValueChange: ignoreReplicas,
          step: 1,
          value: display.replicas,
        }
      : undefined,
    sectionFocus: metadata.sectionFocus,
    showImageSection: false,
    storage: display.storage,
    workloadKind: display.workloadKind,
  };
}

function publicAddressesSectionsHookProps({
  apTarget,
  canEditAp,
  draftRoutingDomain,
  effectiveReadOnly,
  network,
  onNetworkDraftCommit,
}: {
  apTarget: ProjectApTarget | null;
  canEditAp: boolean;
  draftRoutingDomain: string;
  effectiveReadOnly: boolean;
  network: ContainerNetwork | null;
  onNetworkDraftCommit: WorkloadClaimSettingsState["onNetworkDraftCommit"];
}): Parameters<typeof useContainerPublicAddressesSettingsSections>[0] {
  return {
    identityKey:
      apTarget == null ? undefined : `${apTarget.namespace}/${apTarget.name}`,
    network: network ?? {
      privateAddress: "",
      privatePort: 0,
      publicAddresses: [],
    },
    networkPlatformAddressDraftContext:
      apTarget == null
        ? undefined
        : {
            appName: apTarget.name,
            namespace: apTarget.namespace,
            routingDomain: draftRoutingDomain,
          },
    onCustomDomainCnameVerify: canEditAp
      ? verifyCustomDomainCnameFromApi
      : undefined,
    onNetworkDraftCommit:
      canEditAp && network != null ? onNetworkDraftCommit : undefined,
    readOnly: effectiveReadOnly,
  };
}

interface ApSettingsModelInput {
  apTarget: ProjectApTarget | null;
  baseSubtitle: string;
  canEditAp: boolean;
  display: WorkloadClaimSettingsState["display"];
  draftRoutingDomain: string;
  effectiveReadOnly: boolean;
  error: WorkloadClaimSettingsState["error"];
  hasResource: boolean;
  ignoreEnv: WorkloadClaimSettingsState["ignoreEnv"];
  ignoreImage: WorkloadClaimSettingsState["ignoreImage"];
  ignoreNetwork: WorkloadClaimSettingsState["ignoreNetwork"];
  ignoreQuota: WorkloadClaimSettingsState["ignoreQuota"];
  ignoreReplicas: WorkloadClaimSettingsState["ignoreReplicas"];
  isApWorkload: boolean;
  isLoading: boolean;
  network: ContainerNetwork | null;
  nodeData: CanvasContainerNodeData | undefined;
  onEnvChange: WorkloadClaimSettingsState["onEnvChange"];
  onEnvResolvedValue: WorkloadClaimSettingsState["onEnvResolvedValue"];
  onImageChange: WorkloadClaimSettingsState["onImageChange"];
  onNetworkChange: WorkloadClaimSettingsState["onNetworkChange"];
  onNetworkDraftCommit: WorkloadClaimSettingsState["onNetworkDraftCommit"];
  onResourceQuotasCommit: WorkloadClaimSettingsState["onResourceQuotasCommit"];
  onSettingsDraftCommit: WorkloadClaimSettingsState["onSettingsDraftCommit"];
  publicAddressesModel: Pick<
    ReturnType<typeof useContainerPublicAddressesSettingsSections>,
    "footer" | "leaveGuard" | "sections"
  >;
  resolvedView: string;
  settingsSectionsModel: Pick<
    ReturnType<typeof useContainerSettingsSections>,
    "footer" | "leaveGuard" | "sections"
  >;
}

function unavailableApSettingsModel(resolvedView: string): SettingsViewModel {
  return {
    closeAriaLabel: "Close AP settings",
    icon: <Settings2 aria-hidden className="size-4 shrink-0 text-blue-400" />,
    resolvedView,
    sections: [
      {
        content: (
          <p className="text-muted-foreground text-sm">
            AP settings are unavailable.
          </p>
        ),
        id: "unsupported",
        title: "Settings",
      },
    ],
    title: "AP Settings",
  };
}

function apSettingsMessageModel(
  base: Omit<SettingsViewModel, "sections">,
  section: SettingsViewModel["sections"][number]
): SettingsViewModel {
  return { ...base, sections: [section] };
}

function missingApTargetSettingsModel(
  base: Omit<SettingsViewModel, "sections">
): SettingsViewModel {
  return apSettingsMessageModel(base, {
    content: (
      <p className="text-muted-foreground text-sm">
        Select an AP with a name and namespace.
      </p>
    ),
    id: "missing-target",
    title: "Settings",
  });
}

function erroredApSettingsModel({
  base,
  message,
}: {
  base: Omit<SettingsViewModel, "sections">;
  message: string;
}): SettingsViewModel {
  return apSettingsMessageModel(base, {
    content: (
      <p className="text-destructive text-sm" role="alert">
        Could not load AP settings: {message}
      </p>
    ),
    id: "load-error",
    title: "Settings",
  });
}

function loadingApSettingsModel(
  base: Omit<SettingsViewModel, "sections">
): SettingsViewModel {
  return apSettingsMessageModel(base, {
    content: <p className="text-muted-foreground text-sm">Loading AP…</p>,
    id: "loading",
    title: "Settings",
  });
}

function publicAddressesApSettingsModel({
  base,
  network,
  publicAddressesModel,
}: Pick<ApSettingsModelInput, "network" | "publicAddressesModel"> & {
  base: Omit<SettingsViewModel, "sections">;
}): SettingsViewModel {
  return {
    ...base,
    footer: network == null ? undefined : publicAddressesModel.footer,
    leaveGuard: network == null ? null : publicAddressesModel.leaveGuard,
    sections:
      network == null
        ? [
            {
              content: (
                <p className="text-muted-foreground text-sm">
                  Public Address settings are unavailable.
                </p>
              ),
              id: "public-addresses-unavailable",
              title: "Public Addresses",
            },
          ]
        : publicAddressesModel.sections,
  };
}

function apSettingsSectionMetadata(resolvedView: string) {
  const environmentView = resolvedView === AP_SETTINGS_ENVIRONMENT_VIEW;
  return {
    icon: environmentView ? SquarePen : Settings2,
    id: environmentView ? "environment" : "ap-settings",
    sectionFocus: environmentView ? "environment" : "all",
    title: environmentView ? "Environment Variables" : "AP Settings",
  } as const;
}

function fullApSettingsModel({
  base,
  input,
}: {
  base: Omit<SettingsViewModel, "sections">;
  input: ApSettingsModelInput;
}): SettingsViewModel {
  const metadata = apSettingsSectionMetadata(input.resolvedView);

  return {
    ...base,
    footer: input.settingsSectionsModel.footer,
    leaveGuard: input.settingsSectionsModel.leaveGuard,
    sections: input.settingsSectionsModel.sections.map((section) =>
      section.id === metadata.id
        ? {
            ...section,
            icon: section.icon ?? metadata.icon,
            title: section.title || metadata.title,
          }
        : section
    ),
  };
}

function buildApSettingsModel(input: ApSettingsModelInput): SettingsViewModel {
  const { apTarget, resolvedView } = input;
  if (apTarget == null) {
    return unavailableApSettingsModel(resolvedView);
  }

  const base = apSettingsModelBase({
    resolvedView,
    subtitle: input.baseSubtitle,
    target: apTarget,
  });

  if (apTarget.name.trim() === "" || apTarget.namespace.trim() === "") {
    return missingApTargetSettingsModel(base);
  }

  if (input.error != null) {
    return erroredApSettingsModel({ base, message: input.error.message });
  }

  if (input.isLoading && !input.hasResource) {
    return loadingApSettingsModel(base);
  }

  if (resolvedView === AP_SETTINGS_PUBLIC_ADDRESSES_VIEW) {
    return publicAddressesApSettingsModel({
      base,
      network: input.network,
      publicAddressesModel: input.publicAddressesModel,
    });
  }

  return fullApSettingsModel({ base, input });
}

export function ApSettingsProvider({
  kubeconfig = "",
  onModelChange,
  onRepairSideEntry,
  onUpdated,
  readOnly,
  sourceContext,
  target,
  view,
}: SettingsProviderProps) {
  const resolvedView = resolvedApSettingsView(view);
  const apTarget = target.kind === "AP" ? target : null;
  const nodeData =
    sourceContext?.node?.data != null &&
    typeof sourceContext.node.data === "object"
      ? (sourceContext.node.data as CanvasContainerNodeData)
      : undefined;
  const states =
    sourceContext?.node == null
      ? null
      : containerStatesFromNode(sourceContext.node);
  const workloadKind = workloadClaimKindFromStates(states);
  const settingsReadOnly = nodeData?.settingsAccess?.readOnly === true;
  const effectiveReadOnly = readOnly || settingsReadOnly;
  const {
    claimPayload,
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
    onEnvResolvedValue,
    onImageChange,
    onNetworkDraftCommit,
    onNetworkChange,
    onResourceQuotasCommit,
    onSettingsDraftCommit,
  } = useWorkloadClaimSettings({
    dbDsnReferenceSources: nodeData?.dbDsnReferenceSources,
    kubeconfig,
    name: apTarget?.name ?? "",
    namespace: apTarget?.namespace ?? "",
    onAddDbDsnReferenceMutationStart:
      nodeData?.onAddDbDsnReferenceMutationStart,
    onWorkloadMutation: nodeData?.onWorkloadMutation ?? onUpdated,
    readOnly: effectiveReadOnly,
    workloadKind: "AP",
  });
  const resource = k8sGetClaimBody(claimPayload);
  const draftRoutingDomain = draftRoutingDomainFromResource(
    resource,
    kubeconfig
  );
  const canEditAp = isApWorkload && !effectiveReadOnly;
  const baseSubtitle = workloadSettingsSubtitle({
    image: states?.image ?? display.image,
    kind: workloadKind,
  });
  const network = publicAddressNetworkOrNull(display.network);
  const settingsSectionsModel = useContainerSettingsSections(
    apSettingsSectionsHookProps({
      apTarget,
      canEditAp,
      display,
      draftRoutingDomain,
      effectiveReadOnly,
      ignoreEnv,
      ignoreImage,
      ignoreNetwork,
      ignoreQuota,
      ignoreReplicas,
      isApWorkload,
      nodeData,
      onEnvChange,
      onEnvResolvedValue,
      onImageChange,
      onNetworkChange,
      onResourceQuotasCommit,
      onSettingsDraftCommit,
      resolvedView,
    })
  );
  const publicAddressesModel = useContainerPublicAddressesSettingsSections(
    publicAddressesSectionsHookProps({
      apTarget,
      canEditAp,
      draftRoutingDomain,
      effectiveReadOnly,
      network,
      onNetworkDraftCommit,
    })
  );

  useEffect(() => {
    if (apTarget == null) {
      onRepairSideEntry?.(null);
      return;
    }
    const repairEntry = apSettingsRepairEntry({
      resolvedView,
      target: apTarget,
      view,
    });
    if (repairEntry !== undefined) {
      onRepairSideEntry?.(repairEntry);
    }
  }, [apTarget, onRepairSideEntry, resolvedView, view]);

  const model = useMemo<SettingsViewModel>(() => {
    return buildApSettingsModel({
      apTarget,
      baseSubtitle,
      canEditAp,
      display,
      draftRoutingDomain,
      effectiveReadOnly,
      error,
      hasResource: resource != null,
      ignoreEnv,
      ignoreImage,
      ignoreNetwork,
      ignoreQuota,
      ignoreReplicas,
      isApWorkload,
      isLoading,
      network,
      nodeData,
      onEnvChange,
      onEnvResolvedValue,
      onImageChange,
      onNetworkChange,
      onNetworkDraftCommit,
      onResourceQuotasCommit,
      onSettingsDraftCommit,
      publicAddressesModel,
      resolvedView,
      settingsSectionsModel,
    });
  }, [
    baseSubtitle,
    apTarget,
    canEditAp,
    display,
    draftRoutingDomain,
    effectiveReadOnly,
    error,
    ignoreEnv,
    ignoreImage,
    ignoreNetwork,
    ignoreQuota,
    ignoreReplicas,
    isApWorkload,
    isLoading,
    network,
    nodeData,
    onEnvChange,
    onEnvResolvedValue,
    onImageChange,
    onNetworkChange,
    onNetworkDraftCommit,
    onResourceQuotasCommit,
    onSettingsDraftCommit,
    publicAddressesModel,
    resolvedView,
    resource,
    settingsSectionsModel,
  ]);

  const { closeAriaLabel, icon, leaveGuard, subtitle, title } = model;

  useEffect(() => {
    onModelChange({
      closeAriaLabel,
      icon,
      leaveGuard,
      resolvedView,
      sections: [],
      subtitle,
      title,
    });
  }, [
    closeAriaLabel,
    icon,
    leaveGuard,
    onModelChange,
    resolvedView,
    subtitle,
    title,
  ]);

  useEffect(() => {
    return () => onModelChange(null);
  }, [onModelChange]);

  return <SettingsSections model={model} />;
}
