import type {
  ProjectApBoundPublicAccessTarget,
  ProjectResourceTarget,
  ProjectSurfaceTarget,
} from "@/features/panes/target-identity";

export type ProjectCanvasSelection =
  | { kind: "edge"; edgeId: string }
  | { kind: "resource"; target: ProjectResourceTarget }
  | { kind: "publicAddresses"; target: ProjectApBoundPublicAccessTarget };

export function projectCanvasSelectionTarget(
  selection: ProjectCanvasSelection | null | undefined
): ProjectSurfaceTarget | null {
  if (selection == null || selection.kind === "edge") {
    return null;
  }
  return selection.target;
}
