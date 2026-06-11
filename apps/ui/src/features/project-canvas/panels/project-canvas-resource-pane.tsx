"use client";

import type { ReactNode } from "react";
import { WORKLOAD_PANE } from "@/features/project-canvas/canvas-store";
import type {
  ProjectCanvasApResourcePaneKind,
  ProjectCanvasResourcePaneRenderModel,
} from "@/features/project-canvas/surface/rendering-adapter";
import { apSettingsSourceDataFromUnknown } from "@/features/project-settings/ap/ap-settings-context";
import { SettingsHost } from "@/features/project-settings/settings-host";
import type { SettingsLeaveGuardRegistration } from "@/features/project-settings/settings-leave-guard";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import { DatabaseMetricsPane } from "./database-metrics-pane";
import { WorkloadResourcePane } from "./workload-resource-pane";

function workloadPaneMode(kind: ProjectCanvasApResourcePaneKind): string {
  switch (kind) {
    case "apEvents":
      return WORKLOAD_PANE.events;
    case "apHistory":
      return WORKLOAD_PANE.history;
    case "apMetrics":
      return WORKLOAD_PANE.metrics;
    default:
      return kind satisfies never;
  }
}

export interface ProjectCanvasResourcePaneContentProps {
  content: ProjectCanvasResourcePaneRenderModel | null | undefined;
  kubeconfig?: string;
  onClose: () => void;
  onRepairSideEntry?: (entry: ProjectSideSurfaceEntry | null) => void;
  onSettingsLeaveGuardChange?: SettingsLeaveGuardRegistration;
  onUpdated?: () => Promise<unknown>;
  readOnly?: boolean;
}

export function renderProjectCanvasResourcePaneContent({
  content,
  kubeconfig,
  onClose,
  onRepairSideEntry,
  onSettingsLeaveGuardChange,
  onUpdated,
  readOnly = false,
}: ProjectCanvasResourcePaneContentProps): ReactNode {
  if (
    content?.kind === "apEvents" ||
    content?.kind === "apHistory" ||
    content?.kind === "apMetrics"
  ) {
    return (
      <WorkloadResourcePane
        mode={workloadPaneMode(content.kind)}
        node={content.node}
        onClose={onClose}
      />
    );
  }

  if (content?.kind === "dbMetrics") {
    return (
      <DatabaseMetricsPane
        kubeconfig={kubeconfig}
        node={content.node}
        onClose={onClose}
        open
      />
    );
  }

  if (content?.kind === "settings") {
    return (
      <SettingsHost
        entry={content.target}
        kubeconfig={kubeconfig}
        onClose={onClose}
        onRepairSideEntry={onRepairSideEntry}
        onSettingsLeaveGuardChange={onSettingsLeaveGuardChange}
        onUpdated={onUpdated}
        readOnly={readOnly}
        sourceContext={{
          apData: apSettingsSourceDataFromUnknown(content.node?.data),
          databaseData: content.databaseData,
          kind: "canvas",
        }}
      />
    );
  }

  return null;
}

export function ProjectCanvasResourcePane(
  props: ProjectCanvasResourcePaneContentProps
) {
  return renderProjectCanvasResourcePaneContent(props);
}
