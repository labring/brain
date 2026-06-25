"use client";

import {
  fetchAPImageVersionDetail,
  rollbackAPImageVersion,
  useAPImageVersions,
  useBrainProductResource,
} from "@workspace/api/hooks";
import { ProjectSourceDockerIcon } from "@workspace/ui/assets/project-source-icons";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppInput } from "@workspace/ui/components/app-input";
import { Label } from "@workspace/ui/components/label";
import { ResourceSettingsSection } from "@workspace/ui/components/resource-settings/resource-settings";
import { Spinner } from "@workspace/ui/components/spinner";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { SquarePen, Upload } from "lucide-react";
import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import YAML from "yaml";

import {
  containerStatesFromNode,
  workloadClaimKindFromStates,
} from "@/features/project-canvas/flow/container-node-workload";
import { applyApImage } from "@/features/project-settings/ap/k8s/ap-json-patch";
import { readApImage } from "@/features/project-settings/ap/k8s/ap-spec-access";
import { k8sGetClaimBody } from "@/features/project-settings/ap/k8s/claim-mapper";
import {
  errorDescription,
  toastErrorDetail,
  toastPromiseDetail,
} from "@/lib/toast-utils";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
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

function WorkloadHistoryShell({
  children,
  onClose,
  subtitle,
  title,
}: WorkloadHistoryShellProps) {
  return (
    <CanvasResourcePane
      closeAriaLabel="Close workload deployments"
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

function apImageFromClaimPayload(
  claimPayload: ReturnType<typeof useBrainProductResource>["data"]
): string {
  const body = k8sGetClaimBody(claimPayload);
  const spec = body?.spec;
  if (spec == null || typeof spec !== "object" || Array.isArray(spec)) {
    return "";
  }
  return readApImage(spec as Record<string, unknown>) ?? "";
}

function DeploymentImageSection({
  claimPayload,
  kubeconfig,
  name,
  namespace,
  onApplied,
}: {
  claimPayload: ReturnType<typeof useBrainProductResource>["data"];
  kubeconfig: string;
  name: string;
  namespace: string;
  onApplied: () => Promise<unknown>;
}) {
  const imageInputId = useId();
  const claimBody = useMemo(
    () => k8sGetClaimBody(claimPayload),
    [claimPayload]
  );
  const currentImage = useMemo(
    () => apImageFromClaimPayload(claimPayload),
    [claimPayload]
  );
  const [draftImage, setDraftImage] = useState(currentImage);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setDraftImage(currentImage);
  }, [currentImage]);

  const trimmedDraft = draftImage.trim();
  const canUpdate =
    !isUpdating &&
    claimBody != null &&
    kubeconfig.trim() !== "" &&
    name.trim() !== "" &&
    namespace.trim() !== "" &&
    trimmedDraft !== "" &&
    trimmedDraft !== currentImage.trim();

  const applyImageUpdate = useCallback(async () => {
    if (!canUpdate || claimBody == null) {
      return;
    }
    setIsUpdating(true);
    try {
      await applyApImage(kubeconfig, claimBody, trimmedDraft);
      toast.success("Image updated.");
      await onApplied();
    } catch (error) {
      toastErrorDetail(
        "Image update failed.",
        errorDescription(error, "Image update failed.")
      );
    } finally {
      setIsUpdating(false);
    }
  }, [canUpdate, claimBody, kubeconfig, onApplied, trimmedDraft]);

  return (
    <ResourceSettingsSection icon={SquarePen} title="Image">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <Label
            className="text-foreground text-sm leading-none"
            htmlFor={imageInputId}
          >
            Image
          </Label>
          <AppInput
            aria-label="AP image"
            disabled={isUpdating}
            id={imageInputId}
            onChange={(event) => setDraftImage(event.target.value)}
            onKeyDown={async (event) => {
              if (event.key !== "Enter") {
                return;
              }
              event.preventDefault();
              await applyImageUpdate();
            }}
            placeholder="ghcr.io/org/app:1.0.0"
            title={trimmedDraft === "" ? "No image configured" : trimmedDraft}
            value={draftImage}
          />
        </div>
        <div className="flex min-w-0 items-center justify-end">
          <AppButton
            disabled={!canUpdate}
            onClick={async () => {
              await applyImageUpdate();
            }}
            type="button"
            variant="secondary"
          >
            {isUpdating ? (
              <Spinner aria-hidden className="size-4 text-muted-foreground" />
            ) : (
              <Upload aria-hidden className="size-4" />
            )}
            {isUpdating ? "Updating..." : "Update"}
          </AppButton>
        </div>
      </div>
    </ResourceSettingsSection>
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
  const title = name === "" ? "Deployments" : `${name} Deployments`;

  const claim = useBrainProductResource({
    kind: workloadKind,
    kubeconfig,
    name,
    namespace: ns,
  });
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
  const reloadDeployments = useCallback(
    () => Promise.all([claim.mutate(), versions.mutate()]),
    [claim, versions]
  );

  const runRollback = useCallback(
    async (versionHash: string) => {
      await rollbackAPImageVersion({
        kubeconfig,
        name,
        namespace: ns,
        versionHash,
      });
      await reloadDeployments();
    },
    [kubeconfig, name, ns, reloadDeployments]
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
        loading: "Rolling back deployment...",
        success: "AP restored from the selected deployment.",
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
          Deployments apply to AP workloads. Databases use their own lifecycle
          history.
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

  if (claim.error != null) {
    return (
      <WorkloadHistoryShell
        onClose={onClose}
        subtitle={workloadKind}
        title={title}
      >
        <p className="text-destructive text-sm" role="alert">
          Could not load AP image: {claim.error.message}
        </p>
      </WorkloadHistoryShell>
    );
  }

  if (
    (versions.isLoading && versions.data == null) ||
    (claim.isLoading && claim.data == null)
  ) {
    return (
      <WorkloadHistoryShell
        onClose={onClose}
        subtitle={workloadKind}
        title={title}
      >
        <p className="text-muted-foreground text-sm">Loading deployments…</p>
      </WorkloadHistoryShell>
    );
  }

  return (
    <>
      <WorkloadHistoryShell
        onClose={onClose}
        subtitle="This is a introduction placeholder."
        title={title}
      >
        <DeploymentImageSection
          claimPayload={claim.data}
          kubeconfig={kubeconfig}
          name={name}
          namespace={ns}
          onApplied={reloadDeployments}
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
            <AppDialog.Title>Rollback to this deployment?</AppDialog.Title>
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
