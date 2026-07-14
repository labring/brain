import { toast } from "sonner";
import type { ProjectCanvasSelection } from "@/features/panes/canvas-selection";
import type {
  ProjectDrawerSurfaceEntry,
  ProjectMainSurfaceEntry,
  ProjectSideSurfaceEntry,
} from "@/features/panes/surface-state";
import type { ProjectCanvasCommandPlan } from "./command-model";

function commandPlanHasSelection(
  plan: ProjectCanvasCommandPlan
): plan is ProjectCanvasCommandPlan & {
  selection: ProjectCanvasSelection | null;
} {
  return "selection" in plan;
}

export interface ProjectCanvasCommandPlanAdapters {
  bringNodeToFront: (nodeId: string) => void;
  openDrawerSurface: (
    entry: ProjectDrawerSurfaceEntry,
    selection?: ProjectCanvasSelection | null
  ) => void;
  openMainSurface: (
    entry: ProjectMainSurfaceEntry,
    selection?: ProjectCanvasSelection | null
  ) => void;
  openSideSurface: (
    entry: ProjectSideSurfaceEntry,
    selection?: ProjectCanvasSelection | null
  ) => void;
  writeSelection: (selection: ProjectCanvasSelection | null) => void;
}

function applyCommandFeedback(plan: ProjectCanvasCommandPlan) {
  if (plan.feedback?.tone === "error") {
    toast.error(plan.feedback.message);
    return;
  }
  if (plan.feedback?.tone === "info") {
    toast.info(plan.feedback.message);
  }
}

function applyCommandSurface(
  plan: ProjectCanvasCommandPlan,
  selection: ProjectCanvasSelection | null | undefined,
  adapters: ProjectCanvasCommandPlanAdapters
): boolean {
  if (plan.surface === undefined) {
    return false;
  }

  switch (plan.surface.slot) {
    case "drawer":
      adapters.openDrawerSurface(plan.surface.entry, selection);
      return true;
    case "main":
      adapters.openMainSurface(plan.surface.entry, selection);
      return true;
    case "side":
      adapters.openSideSurface(plan.surface.entry, selection);
      return true;
    default:
      return plan.surface satisfies never;
  }
}

export function executeUnguardedProjectCanvasCommandPlan(
  plan: ProjectCanvasCommandPlan,
  adapters: ProjectCanvasCommandPlanAdapters
) {
  applyCommandFeedback(plan);

  if (plan.stackOrder?.kind === "bringNodeToFront") {
    adapters.bringNodeToFront(plan.stackOrder.nodeId);
  }

  const selection = commandPlanHasSelection(plan) ? plan.selection : undefined;
  if (applyCommandSurface(plan, selection, adapters)) {
    return;
  }

  if (commandPlanHasSelection(plan)) {
    adapters.writeSelection(plan.selection);
  }
}
