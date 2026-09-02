import {
  type ProjectCanvasSelection,
  projectCanvasSelectionTarget,
} from "@/features/panes/canvas-selection";
import { resourceDisplayNameForTarget } from "@/features/resource-display-name/resource-display-name-bridge";
import type { SelectedContextReference } from "./persistence/types";

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
