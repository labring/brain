"use client";

import { useAPPublicAddressReadiness } from "@workspace/api/hooks";
import { Router, Settings2, SquarePen } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { ProjectSideSurfaceEntry } from "@/features/panes/surface-state";
import type { ProjectApTarget } from "@/features/panes/target-identity";
import { AP_SETTINGS_REPLICA_LIMITS } from "@/features/resource-settings/ap/ap-settings-context";
import {
  type ApNetwork,
  useApPublicAddressesSettingsSections,
  useApSettingsSections,
} from "@/features/resource-settings/ap/ap-settings-sections";
import { verifyCustomDomainCnameFromApi } from "@/features/resource-settings/ap/custom-domain-cname-client";
import { useApWorkloadSettings } from "@/features/resource-settings/ap/hooks/use-ap-workload-settings";
import { k8sGetClaimBody } from "@/features/resource-settings/ap/k8s/claim-mapper";
import { settingsOwnerIdentity } from "@/features/resource-settings/settings-owner-identity";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { SettingsSections } from "./settings-sections";
import type {
  SettingsProviderProps,
  SettingsViewModel,
} from "./settings-types";

const AP_SETTINGS_FULL_VIEW = "full";
const AP_SETTINGS_ENVIRONMENT_VIEW = "environment";
const AP_SETTINGS_PUBLIC_ADDRESSES_VIEW = "public-addresses";
const EMPTY_PUBLIC_ADDRESS_NETWORK: ApNetwork = {
  privateAddress: "",
  privatePort: 0,
  publicAddresses: [],
};

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
  network: ApNetwork | undefined
): ApNetwork | null {
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
      subtitle: `Container · ${target.namespace}`,
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

type ApWorkloadSettingsState = ReturnType<typeof useApWorkloadSettings>;
type ApSettingsSectionsInput = Parameters<typeof useApSettingsSections>[0];

interface ApSettingsSectionsHookInput {
  apTarget: ProjectApTarget | null;
  canEditAp: boolean;
  dbDsnReferenceSources: ApSettingsSectionsInput["dbDsnReferenceSources"];
  display: ApWorkloadSettingsState["display"];
  draftRoutingDomain: string;
  effectiveReadOnly: boolean;
  ignoreEnv: ApWorkloadSettingsState["ignoreEnv"];
  ignoreImage: ApWorkloadSettingsState["ignoreImage"];
  ignoreNetwork: ApWorkloadSettingsState["ignoreNetwork"];
  ignoreQuota: ApWorkloadSettingsState["ignoreQuota"];
  ignoreReplicas: ApWorkloadSettingsState["ignoreReplicas"];
  isApWorkload: boolean;
  kubeconfig?: string;
  onEnvChange: ApWorkloadSettingsState["onEnvChange"];
  onEnvResolvedValue: ApWorkloadSettingsState["onEnvResolvedValue"];
  onImageChange: ApWorkloadSettingsState["onImageChange"];
  onLaunchContextConsumed?: () => void;
  onNetworkChange: ApWorkloadSettingsState["onNetworkChange"];
  onPendingDbReferencesChange: ApSettingsSectionsInput["onPendingDbReferencesChange"];
  onResourceQuotasCommit: ApWorkloadSettingsState["onResourceQuotasCommit"];
  onSettingsDraftCommit: ApWorkloadSettingsState["onSettingsDraftCommit"];
  pendingDatabaseBindingIntent: ApSettingsSectionsInput["addDbDsnReferenceIntent"];
  publicAddressReadiness?: ApSettingsSectionsInput["publicAddressReadiness"];
  resolvedView: string;
}

function apSettingsSectionsHookProps({
  apTarget,
  canEditAp,
  dbDsnReferenceSources,
  display,
  draftRoutingDomain,
  effectiveReadOnly,
  ignoreEnv,
  ignoreImage,
  ignoreNetwork,
  ignoreQuota,
  ignoreReplicas,
  isApWorkload,
  kubeconfig,
  onEnvChange,
  onEnvResolvedValue,
  onImageChange,
  onLaunchContextConsumed,
  onNetworkChange,
  onPendingDbReferencesChange,
  onResourceQuotasCommit,
  onSettingsDraftCommit,
  pendingDatabaseBindingIntent,
  publicAddressReadiness,
  resolvedView,
}: ApSettingsSectionsHookInput): Parameters<typeof useApSettingsSections>[0] {
  const metadata = apSettingsSectionMetadata(resolvedView);
  return {
    addDbDsnReferenceIntent: pendingDatabaseBindingIntent,
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
    dbDsnReferenceSources,
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
    onAddDbDsnReferenceIntentConsumed: onLaunchContextConsumed,
    onCustomDomainCnameVerify: verifyCustomDomainCnameFromApi,
    onEnvChange: canEditAp ? onEnvChange : ignoreEnv,
    onEnvResolvedValue: canEditAp ? onEnvResolvedValue : undefined,
    onImageChange: canEditAp ? onImageChange : ignoreImage,
    onNetworkChange: canEditAp ? onNetworkChange : ignoreNetwork,
    onPendingDbReferencesChange,
    onResourceQuotasCommit: canEditAp ? onResourceQuotasCommit : undefined,
    onSettingsDraftCommit: canEditAp ? onSettingsDraftCommit : undefined,
    publicAddressReadiness,
    readOnly: !isApWorkload || effectiveReadOnly,
    replicaStrategy: display.replicaStrategy,
    replicasQuota: isApWorkload
      ? {
          ...AP_SETTINGS_REPLICA_LIMITS,
          disabled: !canEditAp,
          onValueChange: ignoreReplicas,
          step: 1,
          value: display.replicas,
        }
      : undefined,
    sectionFocus: metadata.sectionFocus,
    showImageSection: false,
    storage: display.storage,
    submissionOwner: settingsOwnerIdentity({
      kubeconfig,
      target: apTarget,
    }),
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
  publicAddressReadiness,
}: {
  apTarget: ProjectApTarget | null;
  canEditAp: boolean;
  draftRoutingDomain: string;
  effectiveReadOnly: boolean;
  network: ApNetwork | null;
  onNetworkDraftCommit: ApWorkloadSettingsState["onNetworkDraftCommit"];
  publicAddressReadiness?: Parameters<
    typeof useApPublicAddressesSettingsSections
  >[0]["publicAddressReadiness"];
}): Parameters<typeof useApPublicAddressesSettingsSections>[0] {
  return {
    identityKey:
      apTarget == null ? undefined : `${apTarget.namespace}/${apTarget.name}`,
    network: network ?? EMPTY_PUBLIC_ADDRESS_NETWORK,
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
    publicAddressReadiness,
    readOnly: effectiveReadOnly,
  };
}

interface ApSettingsModelInput {
  apTarget: ProjectApTarget | null;
  baseSubtitle: string;
  canEditAp: boolean;
  display: ApWorkloadSettingsState["display"];
  draftRoutingDomain: string;
  effectiveReadOnly: boolean;
  error: ApWorkloadSettingsState["error"];
  hasResource: boolean;
  ignoreEnv: ApWorkloadSettingsState["ignoreEnv"];
  ignoreImage: ApWorkloadSettingsState["ignoreImage"];
  ignoreNetwork: ApWorkloadSettingsState["ignoreNetwork"];
  ignoreQuota: ApWorkloadSettingsState["ignoreQuota"];
  ignoreReplicas: ApWorkloadSettingsState["ignoreReplicas"];
  isApWorkload: boolean;
  isLoading: boolean;
  network: ApNetwork | null;
  onEnvChange: ApWorkloadSettingsState["onEnvChange"];
  onEnvResolvedValue: ApWorkloadSettingsState["onEnvResolvedValue"];
  onImageChange: ApWorkloadSettingsState["onImageChange"];
  onNetworkChange: ApWorkloadSettingsState["onNetworkChange"];
  onNetworkDraftCommit: ApWorkloadSettingsState["onNetworkDraftCommit"];
  onResourceQuotasCommit: ApWorkloadSettingsState["onResourceQuotasCommit"];
  onSettingsDraftCommit: ApWorkloadSettingsState["onSettingsDraftCommit"];
  publicAddressesModel: Pick<
    ReturnType<typeof useApPublicAddressesSettingsSections>,
    "footer" | "leaveGuard" | "sections"
  >;
  resolvedView: string;
  settingsSectionsModel: Pick<
    ReturnType<typeof useApSettingsSections>,
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
  launchContext,
  onLaunchContextConsumed,
  onModelChange,
  onRepairSideEntry,
  onUpdated,
  readModelHints,
  readOnly,
  sessionEvents,
  target,
  view,
}: SettingsProviderProps) {
  const resolvedView = resolvedApSettingsView(view);
  const apTarget = target.kind === "AP" ? target : null;
  const dbDsnReferenceSources = readModelHints?.ap?.dbDsnReferenceSources;
  const effectiveReadOnly = readOnly;
  const pendingDatabaseBindingIntent =
    launchContext?.pendingDatabaseBindingIntent;
  const apSessionEvents = sessionEvents?.ap;
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
  } = useApWorkloadSettings({
    dbDsnReferenceSources,
    kubeconfig,
    name: apTarget?.name ?? "",
    namespace: apTarget?.namespace ?? "",
    onAddDbDsnReferenceMutationStart:
      apSessionEvents?.onAddDbDsnReferenceMutationStart,
    onWorkloadMutation: onUpdated,
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
    image: display.image,
    kind: "Container",
  });
  const network = publicAddressNetworkOrNull(display.network);
  const { data: publicAddressReadiness } = useAPPublicAddressReadiness({
    enabled: apTarget != null && isApWorkload && network != null,
    kubeconfig,
    target:
      apTarget == null
        ? null
        : { name: apTarget.name, namespace: apTarget.namespace },
  });
  const settingsSectionsModel = useApSettingsSections(
    apSettingsSectionsHookProps({
      apTarget,
      canEditAp,
      dbDsnReferenceSources,
      display,
      draftRoutingDomain,
      effectiveReadOnly,
      ignoreEnv,
      ignoreImage,
      ignoreNetwork,
      ignoreQuota,
      ignoreReplicas,
      isApWorkload,
      kubeconfig,
      onEnvChange,
      onEnvResolvedValue,
      onImageChange,
      onLaunchContextConsumed:
        pendingDatabaseBindingIntent == null
          ? undefined
          : onLaunchContextConsumed,
      onNetworkChange,
      onPendingDbReferencesChange: apSessionEvents?.onPendingDbReferencesChange,
      onResourceQuotasCommit,
      onSettingsDraftCommit,
      pendingDatabaseBindingIntent,
      publicAddressReadiness,
      resolvedView,
    })
  );
  const publicAddressesModel = useApPublicAddressesSettingsSections(
    publicAddressesSectionsHookProps({
      apTarget,
      canEditAp,
      draftRoutingDomain,
      effectiveReadOnly,
      network,
      onNetworkDraftCommit,
      publicAddressReadiness,
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
