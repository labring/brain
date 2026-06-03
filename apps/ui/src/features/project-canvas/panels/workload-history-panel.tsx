"use client";

import { useK8sGetResource } from "@workspace/api/hooks";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { ContainerHistoryPane } from "@workspace/ui/components/container-history-pane/container-history-pane";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { History } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  containerStatesFromNode,
  k8sPluralKindForWorkload,
  workloadClaimKindFromStates,
} from "@/features/project-canvas/flow/container-node-workload";
import { apConfigSnapshotRowsFromClaim } from "@/features/project-canvas/k8s/ap-config-snapshots";
import { rollbackApFromEffectiveConfigYaml } from "@/features/project-canvas/k8s/ap-json-patch";
import { k8sGetClaimBody } from "@/features/project-canvas/k8s/claim-mapper";
import { fetchConfigMapConfigYaml } from "@/features/project-canvas/k8s/fetch-configmap-config-yaml";
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
      icon={<History aria-hidden className="size-4 shrink-0 text-blue-400" />}
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
  const pluralKind = k8sPluralKindForWorkload(workloadKind);
  const title = name === "" ? "History" : `${name} History`;

  const {
    data: claimPayload,
    error,
    isLoading,
    mutate: revalidateClaim,
  } = useK8sGetResource({
    kind: pluralKind,
    kubeconfig,
    name,
    namespace: ns,
  });
  const claim = k8sGetClaimBody(claimPayload);

  const rows = useMemo(
    () => (workloadKind === "AP" ? apConfigSnapshotRowsFromClaim(claim) : []),
    [claim, workloadKind]
  );

  const onLoadConfigYaml = useCallback(
    async (configMapName: string) =>
      fetchConfigMapConfigYaml({
        configMapName,
        kubeconfig,
        namespace: ns,
      }),
    [kubeconfig, ns]
  );

  const [rollbackConfirmCm, setRollbackConfirmCm] = useState<string | null>(
    null
  );
  const [rollbackBusyCm, setRollbackBusyCm] = useState<string | null>(null);

  const runRollback = useCallback(
    async (configMapName: string) => {
      if (claim == null) {
        throw new Error("Workload claim is not loaded yet.");
      }
      const yaml = await fetchConfigMapConfigYaml({
        configMapName,
        kubeconfig,
        namespace: ns,
      });
      await rollbackApFromEffectiveConfigYaml(kubeconfig, claim, yaml);
      await revalidateClaim();
    },
    [claim, kubeconfig, ns, revalidateClaim]
  );

  const confirmRollbackSnapshot = () => {
    const cm = rollbackConfirmCm;
    if (cm == null) {
      return;
    }
    setRollbackConfirmCm(null);
    toast.promise(
      (async () => {
        setRollbackBusyCm(cm);
        try {
          await runRollback(cm);
        } finally {
          setRollbackBusyCm(null);
        }
      })(),
      {
        loading: `Rolling back to ${cm}…`,
        success:
          "AP spec updated from the snapshot. Composition will reconcile shortly.",
        error: (e) =>
          e instanceof Error ? e.message : "Rollback failed unexpectedly.",
      }
    );
  };

  const requestRollbackConfirm = useCallback((configMapName: string) => {
    setRollbackConfirmCm(configMapName);
  }, []);

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
          Config snapshot history applies to AP workloads. Database claims use a
          different backup model.
        </p>
      </WorkloadHistoryShell>
    );
  }

  if (error != null) {
    return (
      <WorkloadHistoryShell
        onClose={onClose}
        subtitle={workloadKind}
        title={title}
      >
        <p className="text-destructive text-sm" role="alert">
          Could not load workload: {error.message}
        </p>
      </WorkloadHistoryShell>
    );
  }

  if (isLoading && claim == null) {
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
          rollbackBusyConfigMapName={rollbackBusyCm}
          rows={rows}
          workloadName={name}
        />
      </WorkloadHistoryShell>
      <AppDialog.Root
        onOpenChange={(next) => {
          if (!next) {
            setRollbackConfirmCm(null);
          }
        }}
        open={rollbackConfirmCm !== null}
      >
        <AppDialog.Content>
          <AppDialog.Header>
            <AppDialog.WarningIcon />
            <AppDialog.Title>Rollback to this snapshot?</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body>
            <AppDialog.Description>
              The AP <span className="font-medium text-foreground">{name}</span>{" "}
              spec will be patched to match the embedded effective spec from{" "}
              <span className="break-all font-mono text-foreground">
                {rollbackConfirmCm ?? ""}
              </span>
              . This rolls configuration forward via the claim (Crossplane then
              reconciles workloads).
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
