"use client";

import { useBrainProductResource } from "@workspace/api/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type ApPendingLaunchTarget,
  apPendingTargetForDomain,
  apPendingTargetsEqual,
} from "@/features/resource-settings/ap/ap-pending-settings";
import { apSettingsDraftFromValues } from "@/features/resource-settings/ap/ap-settings-draft";
import { applyApImage } from "@/features/resource-settings/ap/k8s/ap-json-patch";
import {
  claimToApSettings,
  k8sGetClaimBody,
} from "@/features/resource-settings/ap/k8s/claim-mapper";
import {
  classifyPendingSettingsEntry,
  getBrowserPendingSettingsStore,
  type PendingSettingsDomainUpdate,
  type PendingSettingsUpdateEntry,
  usePendingSettingsEntries,
} from "@/features/resource-settings/pending-settings-updates";
import { settingsOwnerIdentity } from "@/features/resource-settings/settings-owner-identity";

const PENDING_RECONCILE_POLL_MS = 2000;

export type ApImageUpdateStatus =
  | { kind: "applying"; targetImage: string }
  | { kind: "diverged"; observedImage: string; targetImage: string }
  | null;

/**
 * The launch-domain pending update an image submit produces. The pending
 * overlay must keep representing the whole intended launch domain: while an
 * earlier launch update is still in flight, the new image merges into that
 * target (and keeps its baseline) instead of rebuilding from observed, which
 * would silently drop the in-flight changes.
 */
export function launchPendingUpdateForImage({
  image,
  inFlight,
  observed,
}: {
  image: string;
  inFlight?: PendingSettingsUpdateEntry<ApPendingLaunchTarget>;
  observed: ApPendingLaunchTarget;
}): PendingSettingsDomainUpdate<ApPendingLaunchTarget> {
  return {
    domain: "launch",
    submittedAgainst: inFlight?.submittedAgainst ?? observed,
    target: { ...(inFlight?.target ?? observed), image },
  };
}

/**
 * Inline image update lifecycle for the AP Image Versions surface (ADR-0062).
 * The submit gesture is local to the pane, but the accepted update becomes the
 * shared launch-domain Pending Settings Update, so AP Settings presents the
 * same target and the same divergence questions.
 */
export function useApImageUpdate({
  enabled,
  kubeconfig,
  name,
  namespace,
}: {
  enabled: boolean;
  kubeconfig: string;
  name: string;
  namespace: string;
}) {
  const active = enabled && kubeconfig.trim() !== "";
  const pendingStore = useMemo(() => getBrowserPendingSettingsStore(), []);
  const owner = useMemo(
    () =>
      settingsOwnerIdentity({
        kubeconfig,
        target: active ? { kind: "AP", name, namespace } : null,
      }),
    [active, kubeconfig, name, namespace]
  );
  const pendingEntries = usePendingSettingsEntries(owner, pendingStore);
  const launchEntry = useMemo(
    () =>
      pendingEntries.find((entry) => entry.domain === "launch") as
        | PendingSettingsUpdateEntry<ApPendingLaunchTarget>
        | undefined,
    [pendingEntries]
  );

  const { data: claimPayload, mutate: revalidateObserved } =
    useBrainProductResource({
      kind: "AP",
      kubeconfig: active ? kubeconfig : "",
      name: active ? name : "",
      namespace,
      refreshInterval: launchEntry == null ? 0 : PENDING_RECONCILE_POLL_MS,
    });
  const claimBody = useMemo(
    () => k8sGetClaimBody(claimPayload),
    [claimPayload]
  );
  const claimBodyRef = useRef(claimBody);
  useEffect(() => {
    claimBodyRef.current = claimBody;
  }, [claimBody]);

  const observedLaunchTarget = useMemo(() => {
    if (claimBody == null) {
      return null;
    }
    const mapped = claimToApSettings(claimBody, "AP");
    return apPendingTargetForDomain(
      "launch",
      apSettingsDraftFromValues({
        args: mapped.args,
        command: mapped.command,
        configMaps: mapped.configMaps,
        cpuCores: mapped.cpuCores,
        env: mapped.env,
        envRawSource: mapped.envRawSource,
        image: mapped.image,
        memoryMib: mapped.memoryMib,
        network: mapped.network,
        replicaStrategy: mapped.replicaStrategy,
        storage: mapped.storage,
        workloadKind: mapped.workloadKind,
      })
    ) as ApPendingLaunchTarget;
  }, [claimBody]);
  const observedLaunchTargetRef = useRef(observedLaunchTarget);
  useEffect(() => {
    observedLaunchTargetRef.current = observedLaunchTarget;
  }, [observedLaunchTarget]);

  const classification = useMemo(() => {
    if (launchEntry == null || observedLaunchTarget == null) {
      return null;
    }
    return classifyPendingSettingsEntry(launchEntry, {
      equals: (left, right) => apPendingTargetsEqual("launch", left, right),
      observed: observedLaunchTarget,
    });
  }, [launchEntry, observedLaunchTarget]);
  const inFlightLaunchEntryRef = useRef<
    PendingSettingsUpdateEntry<ApPendingLaunchTarget> | undefined
  >(undefined);
  useEffect(() => {
    inFlightLaunchEntryRef.current =
      classification?.status === "applying" ||
      classification?.status === "attention-needed"
        ? launchEntry
        : undefined;
  }, [classification, launchEntry]);

  // The pane may be the only open surface watching this AP while an update
  // applies, so reconciled launch entries clear here as well as in settings.
  useEffect(() => {
    if (
      classification?.status !== "reconciled" ||
      owner == null ||
      pendingStore == null
    ) {
      return;
    }
    pendingStore.clear(owner, "launch");
  }, [classification, owner, pendingStore]);

  const status: ApImageUpdateStatus = useMemo(() => {
    if (classification == null || classification.status === "reconciled") {
      return null;
    }
    if (classification.status === "diverged") {
      return {
        kind: "diverged",
        observedImage: observedLaunchTarget?.image ?? "",
        targetImage: classification.entry.target.image,
      };
    }
    return {
      kind: "applying",
      targetImage: classification.entry.target.image,
    };
  }, [classification, observedLaunchTarget]);

  const [submitBusy, setSubmitBusy] = useState(false);
  const submit = useCallback(
    async (image: string) => {
      const img = image.trim();
      const body = claimBodyRef.current;
      const observed = observedLaunchTargetRef.current;
      const kc = kubeconfig.trim();
      if (img === "") {
        throw new Error("Image reference is empty.");
      }
      if (body == null || observed == null || owner == null || kc === "") {
        throw new Error("Workload resource or kubeconfig missing.");
      }
      setSubmitBusy(true);
      try {
        await applyApImage(kc, body, img);
        pendingStore?.replaceDirtyDomains({
          owner,
          updates: [
            launchPendingUpdateForImage({
              image: img,
              inFlight: inFlightLaunchEntryRef.current,
              observed,
            }),
          ],
        });
        await revalidateObserved();
      } finally {
        setSubmitBusy(false);
      }
    },
    [kubeconfig, owner, pendingStore, revalidateObserved]
  );

  // Divergence keep-target: an ordinary resubmission of the entry's image
  // against the current observed baseline — never a special retry path.
  const keepTarget = useCallback(async () => {
    const targetImage = launchEntry?.target.image;
    if (targetImage == null) {
      return;
    }
    await submit(targetImage);
  }, [launchEntry, submit]);

  // Divergence use-latest: forget the local target; no request is sent.
  const adoptLatestObserved = useCallback(() => {
    if (owner == null || pendingStore == null) {
      return;
    }
    pendingStore.clear(owner, "launch");
  }, [owner, pendingStore]);

  // A successful Rollback replaces the whole desired configuration, so every
  // local pending target — any domain, not just launch — is stale against the
  // restored snapshot and would misclassify as applying or diverged.
  const clearPendingAfterRollback = useCallback(() => {
    if (owner == null || pendingStore == null) {
      return;
    }
    pendingStore.clearOwner(owner);
  }, [owner, pendingStore]);

  return {
    baselineImage:
      status?.kind === "applying"
        ? status.targetImage
        : (observedLaunchTarget?.image ?? null),
    clearPendingAfterRollback,
    keepTarget,
    loaded: observedLaunchTarget != null,
    revalidateObserved,
    status,
    submit,
    submitBusy,
    adoptLatestObserved,
  };
}
