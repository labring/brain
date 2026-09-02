"use client";

import { useCallback, useMemo } from "react";
import { projectRuntimeResourceKey } from "@/features/project-canvas/runtime/resource-facts";
import type { ProjectResourceDisplayName } from "@/features/project-canvas/runtime/resource-store";
import { applyResourceDisplayName } from "@/features/resource-display-name/apply-resource-display-name";

/**
 * Shared rename plumbing for the settings pane title (ADR 0066): the names
 * already taken by the Project's other resources (for the duplicate check)
 * and the submit callback that patches the annotation, then revalidates.
 */
export function useResourceDisplayNameRename(input: {
  kind: "AP" | "DB";
  kubeconfig: string;
  onUpdated?: (() => Promise<unknown>) | undefined;
  resourceDisplayNames?: readonly ProjectResourceDisplayName[] | undefined;
  revalidate: () => Promise<unknown>;
  target: { name: string; namespace: string } | null;
}): {
  onRenameResource: (value: string) => Promise<void>;
  takenDisplayNames: string[];
} {
  const { kind, kubeconfig, onUpdated, resourceDisplayNames, revalidate } =
    input;
  const name = input.target?.name ?? "";
  const namespace = input.target?.namespace ?? "";
  const selfResourceKey =
    name === "" || namespace === ""
      ? null
      : projectRuntimeResourceKey({ kind, name, namespace });
  const takenDisplayNames = useMemo(
    () =>
      (resourceDisplayNames ?? [])
        .filter((row) => row.key !== selfResourceKey)
        .map((row) => row.displayName),
    [resourceDisplayNames, selfResourceKey]
  );
  const onRenameResource = useCallback(
    async (value: string) => {
      if (name === "" || namespace === "" || kubeconfig.trim() === "") {
        return;
      }
      await applyResourceDisplayName({
        kind,
        kubeconfig,
        name,
        namespace,
        value,
      });
      await Promise.allSettled([revalidate(), onUpdated?.()]);
    },
    [kind, kubeconfig, name, namespace, onUpdated, revalidate]
  );
  return { onRenameResource, takenDisplayNames };
}
