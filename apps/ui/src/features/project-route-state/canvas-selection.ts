import type {
  ProjectApBoundEntryPointTarget,
  ProjectResourceTarget,
  ProjectSurfaceTarget,
} from "@/features/project-surfaces/target-identity";

export type ProjectCanvasSelection =
  | { kind: "edge"; edgeId: string }
  | { kind: "resource"; target: ProjectResourceTarget }
  | { kind: "publicAddresses"; target: ProjectApBoundEntryPointTarget };

export function projectCanvasSelectionTarget(
  selection: ProjectCanvasSelection | null | undefined
): ProjectSurfaceTarget | null {
  if (selection == null || selection.kind === "edge") {
    return null;
  }
  return selection.target;
}
