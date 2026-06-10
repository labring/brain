"use client";

import { API_ROUTES } from "@workspace/api/constants";
import {
  useBrainProductResource,
  useEntryPointList,
} from "@workspace/api/hooks";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { ApiUrl } from "@workspace/api/utils";
import type {
  ContainerEnvVar,
  ContainerSettingsDraft,
  ContainerSettingsPaneConfirmedAddDbDsnReference,
  ContainerSettingsPaneEnvChangeMeta,
  ContainerSettingsPaneSettingsDraftCommitMeta,
} from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import type { ContainerEnvDbDsnSource } from "@workspace/ui/lib/container-env-rows";
import { settingsDraftSaveFailureMessage } from "@workspace/ui/lib/settings-draft-backing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  applyApEnv,
  applyApImage,
  applyApNetwork,
  applyApPublicAddresses,
  applyApResourceQuotas,
  applyApSettingsDraft,
} from "@/features/project-canvas/k8s/ap-json-patch";
import {
  type ApReplicaStrategy,
  canonicalFixedReplicaStrategy,
} from "@/features/project-canvas/k8s/ap-replica-strategy";
import {
  type ClaimContainerSettings,
  claimToContainerSettings,
  k8sGetClaimBody,
  type WorkloadClaimKind,
} from "@/features/project-canvas/k8s/claim-mapper";
import { existingCustomDomainBindingsFromEntryPoints } from "@/features/project-canvas/k8s/entrypoint-custom-domains";

const WORKLOAD_RECONCILE_POLL_MS = 1000;
const WORKLOAD_RECONCILE_POLL_WINDOW_MS = 30_000;

export interface UseWorkloadClaimSettingsOptions {
  dbDsnReferenceSources?: ContainerEnvDbDsnSource[];
  kubeconfig?: string;
  name: string;
  namespace: string;
  onAddDbDsnReferenceMutationStart?: (
    references: readonly ContainerSettingsPaneConfirmedAddDbDsnReference[]
  ) => (() => void) | undefined;
  onWorkloadMutation?: () => Promise<unknown>;
  readOnly?: boolean;
  workloadKind: WorkloadClaimKind;
}

interface ResourceQuotaCommitDraft {
  cpu: number;
  memory: number;
  replicaStrategy?: ApReplicaStrategy;
  replicas?: number;
}

function resourceQuotaReplicaOverride(
  next: ResourceQuotaCommitDraft,
  currentReplicaStrategy: ApReplicaStrategy
): Partial<ClaimContainerSettings> {
  if (next.replicaStrategy !== undefined) {
    return {
      replicaStrategy: next.replicaStrategy,
      replicas: next.replicaStrategy.fixed.replicas,
    };
  }
  if (next.replicas === undefined) {
    return {};
  }
  const replicas = Math.round(next.replicas);
  return {
    replicaStrategy: canonicalFixedReplicaStrategy(
      replicas,
      currentReplicaStrategy.elastic
    ),
    replicas,
  };
}

function resourceQuotaPatchDraft(next: ResourceQuotaCommitDraft): {
  replicaStrategy?: ApReplicaStrategy;
  replicas?: number;
} {
  if (next.replicaStrategy !== undefined) {
    return { replicaStrategy: next.replicaStrategy };
  }
  if (next.replicas === undefined) {
    return {};
  }
  return { replicas: Math.round(next.replicas) };
}

/**
 * Fetches the AP/DB product resource, maps it to {@link ContainerSettingsPane} props, and exposes
 * JSON Patch–backed mutators for AP workloads (DB stays read-only in the pane).
 */
export function useWorkloadClaimSettings(
  options: UseWorkloadClaimSettingsOptions
) {
  const {
    name,
    namespace,
    onAddDbDsnReferenceMutationStart,
    onWorkloadMutation,
    workloadKind,
  } = options;
  const kubeconfig = options.kubeconfig ?? "";
  const readOnly = options.readOnly === true;
  const dbDsnReferenceSources = options.dbDsnReferenceSources ?? [];
  const isApWorkload = workloadKind === "AP";
  const [claimReconcilePollUntil, setClaimReconcilePollUntil] = useState(0);

  const {
    data: claimPayload,
    error,
    isLoading,
    mutate: revalidateClaim,
  } = useBrainProductResource({
    kind: workloadKind,
    kubeconfig,
    name,
    namespace,
    refreshInterval:
      claimReconcilePollUntil > Date.now() ? WORKLOAD_RECONCILE_POLL_MS : 0,
  });
  const {
    data: entryPointsData,
    error: entryPointsError,
    isLoading: entryPointsLoading,
    mutate: revalidateEntryPoints,
  } = useEntryPointList({
    kubeconfig: isApWorkload ? kubeconfig : "",
    namespace,
    pollWhileEmpty: false,
    refreshInterval:
      isApWorkload && claimReconcilePollUntil > Date.now()
        ? WORKLOAD_RECONCILE_POLL_MS
        : 0,
  });

  const claimBodyRef = useRef<Record<string, unknown> | undefined>(undefined);
  claimBodyRef.current = k8sGetClaimBody(claimPayload);

  const claimResourceVersion = useMemo(() => {
    const b = k8sGetClaimBody(claimPayload);
    const meta = b?.metadata;
    if (meta != null && typeof meta === "object" && "resourceVersion" in meta) {
      const rv = (meta as { resourceVersion?: unknown }).resourceVersion;
      return typeof rv === "string" ? rv : "";
    }
    return "";
  }, [claimPayload]);

  const [localOverride, setLocalOverride] =
    useState<Partial<ClaimContainerSettings> | null>(null);

  // Reset optimistic fields when the fetched claim revision changes (refetch / external edit).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — run when `claimResourceVersion` updates
  useEffect(() => {
    setLocalOverride(null);
  }, [claimResourceVersion]);

  const mapped = useMemo(
    () =>
      claimToContainerSettings(k8sGetClaimBody(claimPayload), workloadKind, {
        dbDsnReferenceSources,
        entryPointsData: isApWorkload ? entryPointsData : undefined,
      }),
    [
      claimPayload,
      dbDsnReferenceSources,
      entryPointsData,
      isApWorkload,
      workloadKind,
    ]
  );
  const existingCustomDomains = useMemo(
    () =>
      isApWorkload
        ? existingCustomDomainBindingsFromEntryPoints(entryPointsData)
        : [],
    [entryPointsData, isApWorkload]
  );

  const display = useMemo(
    () => ({ ...mapped, ...(localOverride ?? {}) }),
    [localOverride, mapped]
  );
  const revalidateAfterApMutation = useCallback(async () => {
    setClaimReconcilePollUntil(Date.now() + WORKLOAD_RECONCILE_POLL_WINDOW_MS);
    await Promise.all([
      revalidateClaim(),
      revalidateEntryPoints(),
      onWorkloadMutation?.().catch(() => undefined),
    ]);
  }, [onWorkloadMutation, revalidateClaim, revalidateEntryPoints]);

  const ignoreImage = useCallback((_image: string) => {
    /* read-only */
  }, []);
  const ignoreEnv = useCallback((_env: ContainerEnvVar[]) => {
    /* read-only */
  }, []);
  const ignoreNetwork = useCallback(() => {
    /* read-only */
  }, []);
  const ignoreQuota = useCallback((_n: number) => {
    /* read-only */
  }, []);
  const ignoreReplicas = useCallback((_n: number) => {
    /* read-only */
  }, []);

  const resolveEnvValue = useCallback(
    async (envName: string) => {
      if (!isApWorkload || readOnly) {
        throw new Error("Environment value reveal is unavailable.");
      }
      const kc = kubeconfig.trim();
      const n = name.trim();
      const ns = namespace.trim();
      const rowName = envName.trim();
      if (kc === "" || n === "" || ns === "" || rowName === "") {
        throw new Error("Workload resource or kubeconfig missing.");
      }
      const url = new URL(API_ROUTES.ap.envValue, ApiUrl());
      url.searchParams.set("name", n);
      url.searchParams.set("namespace", ns);
      url.searchParams.set("envName", rowName);
      const response = await fetch(url.toString(), {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${encodeURIComponent(kc)}`,
        },
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const body = (await response.json()) as { value?: unknown };
      return typeof body.value === "string" ? body.value : "";
    },
    [isApWorkload, kubeconfig, name, namespace, readOnly]
  );

  const onImageChange = useCallback(
    async (image: string) => {
      if (!isApWorkload || readOnly) {
        return;
      }
      const body = claimBodyRef.current;
      const kc = kubeconfig.trim();
      if (body == null || kc === "") {
        toast.error("Workload resource or kubeconfig missing.");
        return;
      }
      setLocalOverride((prev) => ({ ...(prev ?? {}), image }));
      try {
        await applyApImage(kc, body, image);
        toast.success("Image applied.");
        await revalidateAfterApMutation();
      } catch (e) {
        setLocalOverride(null);
        toast.error(e instanceof Error ? e.message : "Apply failed");
      }
    },
    [isApWorkload, kubeconfig, readOnly, revalidateAfterApMutation]
  );

  const onEnvChange = useCallback(
    async (
      env: ContainerEnvVar[],
      meta?: ContainerSettingsPaneEnvChangeMeta
    ) => {
      if (!isApWorkload || readOnly) {
        return;
      }
      const body = claimBodyRef.current;
      const kc = kubeconfig.trim();
      if (body == null || kc === "") {
        toast.error("Workload resource or kubeconfig missing.");
        return;
      }
      setLocalOverride((prev) => ({
        ...(prev ?? {}),
        env,
        ...(meta?.envRawSource == null
          ? {}
          : { envRawSource: meta.envRawSource }),
      }));
      const confirmedReferences = meta?.confirmedAddDbDsnReferences ?? [];
      const clearPendingReferences =
        confirmedReferences.length === 0
          ? undefined
          : onAddDbDsnReferenceMutationStart?.(confirmedReferences);
      try {
        await applyApEnv(kc, body, env, {
          dbDsnReferenceSources,
          envRawSource: meta?.envRawSource,
        });
        toast.success("Environment applied.");
        await revalidateAfterApMutation();
      } catch (e) {
        setLocalOverride(null);
        toast.error(e instanceof Error ? e.message : "Apply failed");
      } finally {
        clearPendingReferences?.();
      }
    },
    [
      isApWorkload,
      dbDsnReferenceSources,
      kubeconfig,
      onAddDbDsnReferenceMutationStart,
      readOnly,
      revalidateAfterApMutation,
    ]
  );

  const onNetworkChange = useCallback(
    async (network: NonNullable<ClaimContainerSettings["network"]>) => {
      if (!isApWorkload || readOnly) {
        return;
      }
      const body = claimBodyRef.current;
      const kc = kubeconfig.trim();
      if (body == null || kc === "") {
        toast.error("Workload resource or kubeconfig missing.");
        return;
      }
      setLocalOverride((prev) => ({ ...(prev ?? {}), network }));
      try {
        await applyApNetwork(kc, body, network, { existingCustomDomains });
        toast.success("Network applied.");
        await revalidateAfterApMutation();
      } catch (e) {
        setLocalOverride(null);
        toast.error(e instanceof Error ? e.message : "Apply failed");
      }
    },
    [
      existingCustomDomains,
      isApWorkload,
      kubeconfig,
      readOnly,
      revalidateAfterApMutation,
    ]
  );

  const onNetworkDraftCommit = useCallback(
    async (network: NonNullable<ClaimContainerSettings["network"]>) => {
      if (!isApWorkload || readOnly) {
        return;
      }
      const body = claimBodyRef.current;
      const kc = kubeconfig.trim();
      if (body == null || kc === "") {
        const error = new Error("Workload resource or kubeconfig missing.");
        toast.error(error.message);
        throw error;
      }
      setLocalOverride((prev) => ({ ...(prev ?? {}), network }));
      try {
        await applyApPublicAddresses(kc, body, network, {
          existingCustomDomains,
        });
        toast.success("Public addresses applied.");
        await revalidateAfterApMutation();
      } catch (e) {
        setLocalOverride(null);
        toast.error(settingsDraftSaveFailureMessage(e, "Apply failed."));
        throw e;
      }
    },
    [
      existingCustomDomains,
      isApWorkload,
      kubeconfig,
      readOnly,
      revalidateAfterApMutation,
    ]
  );

  const onResourceQuotasCommit = useCallback(
    async (next: ResourceQuotaCommitDraft) => {
      if (!isApWorkload || readOnly) {
        return;
      }
      const body = claimBodyRef.current;
      const kc = kubeconfig.trim();
      if (body == null || kc === "") {
        toast.error("Workload resource or kubeconfig missing.");
        return;
      }
      const prevCpu = display.cpuCores;
      const prevMem = display.memoryMib;
      const prevReplicas = display.replicas;
      const replicaOverride = resourceQuotaReplicaOverride(
        next,
        display.replicaStrategy
      );
      const replicaPatch = resourceQuotaPatchDraft(next);

      setLocalOverride((prev) => ({
        ...(prev ?? {}),
        cpuCores: next.cpu,
        memoryMib: next.memory,
        ...replicaOverride,
      }));
      try {
        await applyApResourceQuotas(
          kc,
          body,
          {
            cpuCores: next.cpu,
            memoryMib: next.memory,
            ...replicaPatch,
          },
          {
            cpuCores: prevCpu,
            memoryMib: prevMem,
            ...(replicaPatch.replicas === undefined
              ? {}
              : { replicas: prevReplicas }),
          }
        );
        toast.success("Resource quota applied.");
        await revalidateAfterApMutation();
      } catch (e) {
        setLocalOverride(null);
        toast.error(e instanceof Error ? e.message : "Apply failed");
      }
    },
    [
      display.cpuCores,
      display.memoryMib,
      display.replicaStrategy,
      display.replicas,
      isApWorkload,
      kubeconfig,
      readOnly,
      revalidateAfterApMutation,
    ]
  );

  const onSettingsDraftCommit = useCallback(
    async (
      draft: ContainerSettingsDraft,
      meta?: ContainerSettingsPaneSettingsDraftCommitMeta
    ) => {
      if (!isApWorkload || readOnly) {
        return;
      }
      const body = claimBodyRef.current;
      const kc = kubeconfig.trim();
      if (body == null || kc === "") {
        const error = new Error("Workload resource or kubeconfig missing.");
        toast.error(error.message);
        throw error;
      }

      const previous: ContainerSettingsDraft = meta?.baseDraft ?? {
        cpuCores: display.cpuCores,
        env: display.env,
        envRawSource: display.envRawSource,
        image: display.image,
        memoryMib: display.memoryMib,
        ...(display.network == null ? {} : { network: display.network }),
        replicaStrategy: display.replicaStrategy,
        replicas: display.replicas,
      };
      const confirmedReferences = meta?.confirmedAddDbDsnReferences ?? [];
      const clearPendingReferences =
        confirmedReferences.length === 0
          ? undefined
          : onAddDbDsnReferenceMutationStart?.(confirmedReferences);

      try {
        await applyApSettingsDraft(kc, body, draft, previous, {
          dbDsnReferenceSources,
          existingCustomDomains,
        });
        toast.success("Settings applied.");
        await revalidateAfterApMutation();
      } catch (e) {
        toast.error(settingsDraftSaveFailureMessage(e, "Apply failed."));
        throw e;
      } finally {
        clearPendingReferences?.();
      }
    },
    [
      display.cpuCores,
      display.env,
      display.envRawSource,
      display.image,
      display.memoryMib,
      display.network,
      display.replicaStrategy,
      display.replicas,
      dbDsnReferenceSources,
      existingCustomDomains,
      isApWorkload,
      kubeconfig,
      onAddDbDsnReferenceMutationStart,
      readOnly,
      revalidateAfterApMutation,
    ]
  );

  return {
    claimPayload: claimPayload as K8sGetResponse | undefined,
    display,
    error: error ?? (isApWorkload ? entryPointsError : undefined),
    ignoreEnv,
    ignoreImage,
    ignoreNetwork,
    ignoreQuota,
    ignoreReplicas,
    isApWorkload,
    isLoading: isLoading || (isApWorkload && entryPointsLoading),
    onEnvChange,
    onEnvResolvedValue: resolveEnvValue,
    onImageChange,
    onNetworkChange,
    onNetworkDraftCommit,
    onResourceQuotasCommit,
    onSettingsDraftCommit,
    revalidateClaim,
  };
}
