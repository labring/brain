import type { Connection, Node } from "@xyflow/react";
import type { ProjectCanvasCommandPlan } from "./command-plan";
import { planDatabaseBindingIntent } from "./database-binding-intents";
import {
  type ProjectCanvasResourceSurfaceIntent,
  planResourceSurfaceIntent,
} from "./resource-surface-intents";

export type {
  ProjectCanvasCommandPlan,
  ProjectCanvasCommandSurfacePlan,
} from "./command-plan";

export type ProjectCanvasCommandIntent =
  | ProjectCanvasResourceSurfaceIntent
  | { kind: "connectingEdge"; connection: Connection };

export interface PlanProjectCanvasCommandOptions {
  intent: ProjectCanvasCommandIntent;
  nodes: readonly Node[];
  readOnly: boolean;
}

export function planProjectCanvasCommand({
  intent,
  nodes,
  readOnly,
}: PlanProjectCanvasCommandOptions): ProjectCanvasCommandPlan {
  switch (intent.kind) {
    case "containerQuickAction":
      return planResourceSurfaceIntent(intent);
    case "connectingEdge":
      return planDatabaseBindingIntent({
        connection: intent.connection,
        nodes,
        readOnly,
      });
    case "databaseQuickAction":
      return planResourceSurfaceIntent(intent);
    case "nodeClick":
      return planResourceSurfaceIntent(intent);
    default:
      return intent satisfies never;
  }
}
