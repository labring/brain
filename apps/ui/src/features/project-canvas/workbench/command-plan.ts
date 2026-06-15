import type { ProjectCanvasSelection } from "@/features/project-route-state/canvas-selection";
import type {
  ProjectDrawerSurfaceEntry,
  ProjectMainSurfaceEntry,
  ProjectSideSurfaceEntry,
} from "@/features/project-surfaces/surface-state";

export type ProjectCanvasCommandSurfacePlan =
  | { entry: ProjectSideSurfaceEntry; slot: "side" }
  | { entry: ProjectMainSurfaceEntry; slot: "main" }
  | { entry: ProjectDrawerSurfaceEntry; slot: "drawer" };

export interface ProjectCanvasCommandPlan {
  feedback?: {
    message: string;
    tone: "error" | "info";
  };
  guard?: {
    action: "switch";
    kind: "settingsLeave";
  };
  pendingDbReference?: {
    apNodeId: string;
    dbName: string;
    dbNamespace: string;
  };
  selection?: ProjectCanvasSelection | null;
  stackOrder?: {
    kind: "bringNodeToFront";
    nodeId: string;
  };
  surface?: ProjectCanvasCommandSurfacePlan;
}
