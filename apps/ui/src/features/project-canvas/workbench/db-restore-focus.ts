import type { ProjectCanvasSelection } from "@/features/project-route-state/canvas-selection";
import type { ProjectMainSurfaceEntry } from "@/features/project-surfaces/surface-state";
import {
  type ProjectDbTarget,
  projectDbTarget,
  targetsEqual,
} from "@/features/project-surfaces/target-identity";

export const DB_RESTORE_CANVAS_FOCUS_TIMEOUT_MS = 10_000;

export interface PendingDbServiceRestoreFocus {
  id: number;
  restoredTarget: ProjectDbTarget;
  sourceTarget: ProjectDbTarget;
}

export function restoredDbServiceTargetFromAccepted(input: {
  name: string;
  namespace: string;
}): ProjectDbTarget | null {
  return projectDbTarget({
    name: input.name,
    namespace: input.namespace,
  });
}

export function canvasSelectionForRestoredDbService(
  target: ProjectDbTarget
): ProjectCanvasSelection {
  return { kind: "resource", target };
}

export function shouldCancelPendingDbServiceRestoreFocus({
  main,
  pending,
}: {
  main: ProjectMainSurfaceEntry | null;
  pending: PendingDbServiceRestoreFocus;
}): boolean {
  return (
    main?.kind !== "dbAccess" ||
    !targetsEqual(main.target, pending.sourceTarget)
  );
}
