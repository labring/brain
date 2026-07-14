"use client";

import type { ReactNode } from "react";
import type { ProjectSideSurfaceEntry } from "@/features/panes/surface-state";
import { WORKLOAD_PANE } from "@/features/project-canvas/canvas-store";
import type {
  ProjectCanvasApResourcePaneKind,
  ProjectCanvasResourcePaneRenderModel,
} from "@/features/project-canvas/surface/rendering-adapter";
import { SettingsHost } from "@/features/resource-settings/settings-host";
import type { SettingsLeaveGuardRegistration } from "@/features/resource-settings/settings-leave-guard";
import type {
  SettingsLaunchContext,
  SettingsReadModelHints,
  SettingsSessionEvents,
} from "@/features/resource-settings/settings-types";
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
  onLaunchContextConsumed?: () => void;
  onRepairSideEntry?: (entry: ProjectSideSurfaceEntry | null) => void;
  onSettingsLeaveGuardChange?: SettingsLeaveGuardRegistration;
  onUpdated?: () => Promise<unknown>;
  readOnly?: boolean;
  settingsLaunchContext?: SettingsLaunchContext;
  settingsReadModelHints?: SettingsReadModelHints;
  settingsSessionEvents?: SettingsSessionEvents;
}

export function renderProjectCanvasResourcePaneContent({
  content,
  kubeconfig,
  onClose,
  onLaunchContextConsumed,
  onRepairSideEntry,
  onSettingsLeaveGuardChange,
  onUpdated,
  readOnly = false,
  settingsLaunchContext,
  settingsReadModelHints,
  settingsSessionEvents,
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
        launchContext={settingsLaunchContext}
        onClose={onClose}
        onLaunchContextConsumed={onLaunchContextConsumed}
        onRepairSideEntry={onRepairSideEntry}
        onSettingsLeaveGuardChange={onSettingsLeaveGuardChange}
        onUpdated={onUpdated}
        readModelHints={settingsReadModelHints}
        readOnly={readOnly}
        sessionEvents={settingsSessionEvents}
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
