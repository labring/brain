import {
  type ProjectCanvasSelection,
  projectCanvasSelectionTarget,
} from "@/features/panes/canvas-selection";
import type { ProjectSurfaceTarget } from "@/features/panes/target-identity";
import { resourceDisplayNameForTarget } from "@/features/resource-display-name/resource-display-name-bridge";
import type { SelectedContextReference } from "./persistence/types";
import type { SelectedContextResourceIdentity } from "./selected-context";

function selectedTargetName(target: ProjectSurfaceTarget): string {
  return target.kind === "PublicAccess" ? target.apName : target.name;
}

/** Prefer the current Project UID, falling back to the send-time URL snapshot. */
export function observedUidForSelectedResource(input: {
  fallback?: string;
  resources: readonly SelectedContextResourceIdentity[];
  selected: ProjectCanvasSelection | null;
}): string | undefined {
  const target = projectCanvasSelectionTarget(input.selected);
  if (target == null) {
    return input.fallback;
  }
  const name = selectedTargetName(target);
  return (
    input.resources.find(
      (resource) =>
        resource.kind === target.kind &&
        resource.name === name &&
        resource.namespace === target.namespace
    )?.observedUid ?? input.fallback
  );
}

/** Freeze the Project and selected resource identity onto one user message. */
export function buildSelectedResourceSnapshot(input: {
  observedUid?: string;
  projectId: string;
  selected: ProjectCanvasSelection | null;
}): SelectedContextReference | null {
  const target = projectCanvasSelectionTarget(input.selected);
  const projectId = input.projectId.trim();
  if (target == null || projectId === "") {
    return null;
  }
  const name = target.kind === "PublicAccess" ? target.apName : target.name;
  const displayName = resourceDisplayNameForTarget(target);
  return {
    ...(displayName == null || displayName === name ? {} : { displayName }),
    type: "resource",
    kind: target.kind,
    name,
    namespace: target.namespace,
    ...(input.observedUid == null ? {} : { observedUid: input.observedUid }),
    projectId,
  };
}
