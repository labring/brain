"use client";

import {
  fetchAPImageVersionDetail,
  rollbackAPImageVersion,
  useAPImageVersions,
} from "@workspace/api/hooks";
import { ProjectSourceDockerIcon } from "@workspace/ui/assets/project-source-icons";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { memo, useCallback, useState } from "react";
import YAML from "yaml";

import {
  containerStatesFromNode,
  workloadClaimKindFromStates,
} from "@/features/project-canvas/flow/container-node-workload";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
import { errorDescription, toastPromiseDetail } from "@/lib/toast-utils";
import {
  CanvasResourcePane,
  type CanvasResourcePaneProps,
} from "./canvas-resource-pane";
import { ContainerHistoryPane } from "./workload-history/container-history-pane";
import type { ContainerHistorySnapshotRow } from "./workload-history/container-history-pane.types";
import { ImageUpdateSection } from "./workload-history/image-update-section";
import { useApImageUpdate } from "./workload-history/use-ap-image-update";

type WorkloadHistoryShellProps = Pick<
  CanvasResourcePaneProps,
  "children" | "onClose" | "subtitle" | "title"
>;

const IMAGE_VERSIONS_DESCRIPTION = "Retained image versions for rollback.";
const VERSION_LIMIT = 10;

function formatImageVersionCount(count: number): string {
  if (count === 1) {
    return "1 Version";
  }
  if (count >= VERSION_LIMIT) {
    return `Latest ${VERSION_LIMIT}`;
  }
  return `${count} Versions`;
}

export function formatImageVersionsSubtitle({
  count,
  state,
}: {
  count: number;
  state: "error" | "loading" | "ready";
}): string {
  let status = formatImageVersionCount(count);
  if (state === "loading") {
    status = "Loading";
  }
  if (state === "error") {
    status = "Unavailable";
  }
  return `${IMAGE_VERSIONS_DESCRIPTION} ${status}`;
}

function WorkloadHistoryShell({
  children,
  onClose,
  subtitle,
  title,
}: WorkloadHistoryShellProps) {
  return (
    <CanvasResourcePane
      closeAriaLabel="Close image versions"
      icon={
        <ProjectSourceDockerIcon
          aria-hidden
          className="size-4 shrink-0 text-blue-400"
        />
      }
      onClose={onClose}
      subtitle={subtitle}
      title={title}
    >
      {children}
    </CanvasResourcePane>
  );
}

export const WorkloadHistoryPane = memo(function WorkloadHistoryPane({
  node,
  onClose,
  onWorkloadMutation,
}: {
  node: Node;
  onClose: () => void;
  /** Refreshes canvas workload lists so node cards reflect the accepted change. */
  onWorkloadMutation?: () => Promise<unknown>;
}) {
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespaceFallback = useAtomValue(namespaceAtom).trim();

  const states = containerStatesFromNode(node);
  const name = states?.name ?? "";
  const ns = states?.namespace?.trim() || namespaceFallback;
  const workloadKind = workloadClaimKindFromStates(states);
  const title = name === "" ? "Image versions" : `${name} Image versions`;

  const versions = useAPImageVersions({
    kubeconfig,
    name,
    namespace: ns,
  });

  const imageUpdate = useApImageUpdate({
    enabled: workloadKind === "AP" && name !== "" && ns !== "",
    kubeconfig,
    name,
    namespace: ns,
  });
  const [editedImage, setEditedImage] = useState<string | null>(null);
  const baselineImage = imageUpdate.baselineImage ?? "";
  const displayImage = editedImage ?? baselineImage;
  const imageDirty =
    editedImage != null &&
    editedImage.trim() !== "" &&
    editedImage.trim() !== baselineImage;

  const submitImageUpdate = useCallback(() => {
    const image = displayImage.trim();
    toastPromiseDetail(
      (async () => {
        await imageUpdate.submit(image);
        setEditedImage(null);
        await Promise.all([
          versions.mutate(),
          onWorkloadMutation?.().catch(() => undefined),
        ]);
      })(),
      {
        errorDescription: (e) => errorDescription(e, "Image update failed."),
        errorTitle: "Image update failed.",
        loading: "Submitting image update...",
        success: "Update accepted. Applying changes.",
      }
    );
  }, [displayImage, imageUpdate, onWorkloadMutation, versions]);

  const keepImageTarget = useCallback(() => {
    toastPromiseDetail(
      (async () => {
        await imageUpdate.keepTarget();
        // The resubmitted target is the truth now; a draft typed mid-apply
        // must not keep overlaying it.
        setEditedImage(null);
        await Promise.all([
          versions.mutate(),
          onWorkloadMutation?.().catch(() => undefined),
        ]);
      })(),
      {
        errorDescription: (e) => errorDescription(e, "Image update failed."),
        errorTitle: "Image update failed.",
        loading: "Resubmitting your target image...",
        success: "Update accepted. Applying changes.",
      }
    );
  }, [imageUpdate, onWorkloadMutation, versions]);

  const onLoadConfigYaml = useCallback(
    async (versionHash: string) => {
      const version = await fetchAPImageVersionDetail({
        kubeconfig,
        name,
        namespace: ns,
        versionHash,
      });
      if (version.specSnapshot != null) {
        return YAML.stringify({
          apiVersion: "brain.io/direct",
          kind: "AP",
          metadata: { name, namespace: ns },
          spec: version.specSnapshot,
        }).trimEnd();
      }
      return [
        `image: ${version.image}`,
        version.imagePullPolicy == null || version.imagePullPolicy === ""
          ? null
          : `imagePullPolicy: ${version.imagePullPolicy}`,
        `versionHash: ${version.versionHash}`,
        `source: ${version.source}`,
        `createdAt: ${version.createdAt}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
    },
    [kubeconfig, name, ns]
  );

  const [rollbackConfirmVersion, setRollbackConfirmVersion] = useState<
    string | null
  >(null);
  const [rollbackBusyVersion, setRollbackBusyVersion] = useState<string | null>(
    null
  );

  const useLatestImage = useCallback(() => {
    imageUpdate.adoptLatestObserved();
    // Adopting the observed image means showing it; drop any stale draft.
    setEditedImage(null);
  }, [imageUpdate]);

  const runRollback = useCallback(
    async (versionHash: string) => {
      await rollbackAPImageVersion({
        kubeconfig,
        name,
        namespace: ns,
        versionHash,
      });
      // The snapshot is the new desired configuration across every domain;
      // surviving pending targets would misreport against it (ADR-0062).
      imageUpdate.clearPendingAfterRollback();
      await Promise.all([
        versions.mutate(),
        imageUpdate.revalidateObserved(),
        onWorkloadMutation?.().catch(() => undefined),
      ]);
    },
    [imageUpdate, kubeconfig, name, ns, onWorkloadMutation, versions]
  );

  const confirmRollbackSnapshot = () => {
    const versionHash = rollbackConfirmVersion;
    if (versionHash == null) {
      return;
    }
    setRollbackConfirmVersion(null);
    // Confirming rollback discards any unsubmitted inline image edit — the
    // dialog names this whenever the edit exists.
    setEditedImage(null);
    toastPromiseDetail(
      (async () => {
        setRollbackBusyVersion(versionHash);
        try {
          await runRollback(versionHash);
        } finally {
          setRollbackBusyVersion(null);
        }
      })(),
      {
        errorDescription: (e) =>
          errorDescription(e, "Rollback failed unexpectedly."),
        errorTitle: "Rollback failed.",
        loading: "Rolling back version...",
        success: "AP restored from the selected version.",
      }
    );
  };

  const requestRollbackConfirm = useCallback((versionHash: string) => {
    setRollbackConfirmVersion(versionHash);
  }, []);

  const rows: ContainerHistorySnapshotRow[] =
    workloadKind === "AP"
      ? (versions.data?.items ?? []).map((item) => ({
          createdAt: item.createdAt,
          image: item.image,
          imagePullPolicy: item.imagePullPolicy,
          source: item.source,
          variant: item.active ? "active" : "orphan",
          versionHash: item.versionHash,
        }))
      : [];

  let subtitleState: "error" | "loading" | "ready" = "ready";
  if (versions.error != null) {
    subtitleState = "error";
  } else if (versions.isLoading && versions.data == null) {
    subtitleState = "loading";
  }
  const subtitle = formatImageVersionsSubtitle({
    count: rows.length,
    state: subtitleState,
  });

  if (ns === "" || name === "") {
    return (
      <WorkloadHistoryShell
        onClose={onClose}
        subtitle={IMAGE_VERSIONS_DESCRIPTION}
        title={title}
      >
        <p className="text-muted-foreground text-sm">
          Select a workload with a name and configure namespace in settings.
        </p>
      </WorkloadHistoryShell>
    );
  }

  if (workloadKind !== "AP") {
    return (
      <WorkloadHistoryShell
        onClose={onClose}
        subtitle={IMAGE_VERSIONS_DESCRIPTION}
        title={title}
      >
        <p className="text-muted-foreground text-sm">
          Image versions apply to AP workloads. Databases use their own
          lifecycle history.
        </p>
      </WorkloadHistoryShell>
    );
  }

  if (versions.error != null) {
    return (
      <WorkloadHistoryShell onClose={onClose} subtitle={subtitle} title={title}>
        <p className="text-destructive text-sm" role="alert">
          Could not load image versions: {versions.error.message}
        </p>
      </WorkloadHistoryShell>
    );
  }

  if (versions.isLoading && versions.data == null) {
    return (
      <WorkloadHistoryShell onClose={onClose} subtitle={subtitle} title={title}>
        <p className="text-muted-foreground text-sm">Loading image versions…</p>
      </WorkloadHistoryShell>
    );
  }

  return (
    <>
      <WorkloadHistoryShell onClose={onClose} subtitle={subtitle} title={title}>
        <ImageUpdateSection
          busy={imageUpdate.submitBusy}
          dirty={imageDirty}
          disabled={!imageUpdate.loaded}
          onChange={setEditedImage}
          onKeepTarget={keepImageTarget}
          onSubmit={submitImageUpdate}
          onUseLatest={useLatestImage}
          status={imageUpdate.status}
          value={displayImage}
        />
        <ContainerHistoryPane
          className="min-h-0"
          onLoadConfigYaml={onLoadConfigYaml}
          onRollback={requestRollbackConfirm}
          rollbackBusyVersionHash={rollbackBusyVersion}
          rows={rows}
          workloadName={name}
        />
      </WorkloadHistoryShell>
      <AppDialog.Root
        onOpenChange={(next) => {
          if (!next) {
            setRollbackConfirmVersion(null);
          }
        }}
        open={rollbackConfirmVersion !== null}
      >
        <AppDialog.Content>
          <AppDialog.Header>
            <AppDialog.WarningIcon />
            <AppDialog.Title>Rollback to this version?</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body>
            <AppDialog.Description>
              The AP <span className="font-medium text-foreground">{name}</span>{" "}
              settings will be restored from the selected recorded version{" "}
              <span className="break-all font-mono text-foreground">
                {rollbackConfirmVersion ?? ""}
              </span>
              . Storage rollback still follows Kubernetes constraints: PVCs
              cannot shrink or change mount paths.
            </AppDialog.Description>
            {imageDirty ? (
              <AppDialog.Description className="text-foreground">
                You have an unsubmitted image edit. Continuing discards it.
              </AppDialog.Description>
            ) : null}
          </AppDialog.Body>
          <AppDialog.Footer>
            <AppDialog.Cancel type="button">Cancel</AppDialog.Cancel>
            <AppDialog.DestructiveAction
              onClick={(e) => {
                e.preventDefault();
                confirmRollbackSnapshot();
              }}
              type="button"
            >
              Rollback
            </AppDialog.DestructiveAction>
          </AppDialog.Footer>
        </AppDialog.Content>
      </AppDialog.Root>
    </>
  );
});

WorkloadHistoryPane.displayName = "WorkloadHistoryPane";
