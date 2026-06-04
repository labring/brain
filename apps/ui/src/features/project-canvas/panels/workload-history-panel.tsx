"use client";

import {
  fetchAPImageVersionDetail,
  rollbackAPImageVersion,
  useAPImageVersions,
} from "@workspace/api/hooks";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { ContainerHistoryPane } from "@workspace/ui/components/container-history-pane/container-history-pane";
import type { ContainerHistorySnapshotRow } from "@workspace/ui/components/container-history-pane/container-history-pane.types";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { History } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";

import {
  containerStatesFromNode,
  workloadClaimKindFromStates,
} from "@/features/project-canvas/flow/container-node-workload";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import {
  CanvasResourcePane,
  type CanvasResourcePaneProps,
} from "./canvas-resource-pane";

type WorkloadHistoryShellProps = Pick<
  CanvasResourcePaneProps,
  "children" | "onClose" | "subtitle" | "title"
>;

function WorkloadHistoryShell({
  children,
  onClose,
  subtitle,
  title,
}: WorkloadHistoryShellProps) {
  return (
    <CanvasResourcePane
      closeAriaLabel="Close workload history"
      icon={<History aria-hidden className="size-4 shrink-0 text-blue-500" />}
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
  const title = name === "" ? "History" : `${name} History`;

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
    toast.promise(
      (async () => {
        setRollbackBusyVersion(versionHash);
        try {
          await runRollback(versionHash);
        } finally {
          setRollbackBusyVersion(null);
        }
      })(),
      {
        loading: "Rolling back image version...",
        success: "AP image updated from the selected version.",
        error: (e) =>
          e instanceof Error ? e.message : "Rollback failed unexpectedly.",
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

  if (ns === "" || name === "") {
    return (
      <WorkloadHistoryShell
        onClose={onClose}
        subtitle={workloadKind}
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
        subtitle={workloadKind}
        title={title}
      >
        <p className="text-muted-foreground text-sm">
          Image version history applies to AP workloads. Databases use their own
          lifecycle history.
        </p>
      </WorkloadHistoryShell>
    );
  }

  if (versions.error != null) {
    return (
      <WorkloadHistoryShell
        onClose={onClose}
        subtitle={workloadKind}
        title={title}
      >
        <p className="text-destructive text-sm" role="alert">
          Could not load image versions: {versions.error.message}
        </p>
      </WorkloadHistoryShell>
    );
  }

  if (versions.isLoading && versions.data == null) {
    return (
      <WorkloadHistoryShell
        onClose={onClose}
        subtitle={workloadKind}
        title={title}
      >
        <p className="text-muted-foreground text-sm">Loading history…</p>
      </WorkloadHistoryShell>
    );
  }

  return (
    <>
      <WorkloadHistoryShell
        onClose={onClose}
        subtitle={workloadKind}
        title={title}
      >
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
            <AppDialog.Title>Rollback to this image?</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body>
            <AppDialog.Description>
              The AP <span className="font-medium text-foreground">{name}</span>{" "}
              image will be changed to the selected recorded version{" "}
              <span className="break-all font-mono text-foreground">
                {rollbackConfirmVersion ?? ""}
              </span>
              . Other AP settings will stay unchanged.
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
