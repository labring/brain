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
}: {
  node: Node;
  onClose: () => void;
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

  const runRollback = useCallback(
    async (versionHash: string) => {
      await rollbackAPImageVersion({
        kubeconfig,
        name,
        namespace: ns,
        versionHash,
      });
      await versions.mutate();
    },
    [kubeconfig, name, ns, versions]
  );

  const confirmRollbackSnapshot = () => {
    const versionHash = rollbackConfirmVersion;
    if (versionHash == null) {
      return;
    }
    setRollbackConfirmVersion(null);
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
