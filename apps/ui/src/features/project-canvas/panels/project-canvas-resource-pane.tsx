"use client";

import type { ReactNode } from "react";
import { WORKLOAD_PANE } from "@/features/project-canvas/canvas-store";
import type {
  ProjectCanvasApResourcePaneKind,
  ProjectCanvasResourcePaneRenderModel,
} from "@/features/project-canvas/surface/rendering-adapter";
import { CanvasResourcePanePresence } from "./canvas-resource-pane";
import { DatabaseMetricsPane } from "./database-metrics-pane";
import { DatabaseSettingsPane } from "./database-settings-pane";
import { EntryPointSettingsPane } from "./entrypoint-settings-panel";
import type { SettingsLeaveGuardRegistration } from "./settings-leave-guard";
import { WorkloadResourcePane } from "./workload-resource-pane";

function workloadPaneMode(kind: ProjectCanvasApResourcePaneKind): string {
  switch (kind) {
    case "apEvents":
      return WORKLOAD_PANE.events;
    case "apHistory":
      return WORKLOAD_PANE.history;
    case "apMetrics":
      return WORKLOAD_PANE.metrics;
    case "apSettings":
      return WORKLOAD_PANE.settings;
    default:
      return kind satisfies never;
  }
}

export interface ProjectCanvasResourcePaneContentProps {
  content: ProjectCanvasResourcePaneRenderModel | null | undefined;
  kubeconfig?: string;
  onClose: () => void;
  onSettingsLeaveGuardChange?: SettingsLeaveGuardRegistration;
  onUpdated?: () => Promise<unknown>;
  readOnly?: boolean;
}

export function renderProjectCanvasResourcePaneContent({
  content,
  kubeconfig,
  onClose,
  onSettingsLeaveGuardChange,
  onUpdated,
  readOnly = false,
}: ProjectCanvasResourcePaneContentProps): ReactNode {
  if (
    content?.kind === "apEvents" ||
    content?.kind === "apHistory" ||
    content?.kind === "apMetrics" ||
    content?.kind === "apSettings"
  ) {
    return (
      <WorkloadResourcePane
        mode={workloadPaneMode(content.kind)}
        node={content.node}
        onClose={onClose}
        onSettingsLeaveGuardChange={onSettingsLeaveGuardChange}
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

  if (content?.kind === "dbSettings") {
    return (
      <DatabaseSettingsPane
        data={content.databaseData}
        kubeconfig={kubeconfig}
        onClose={onClose}
        onSettingsLeaveGuardChange={onSettingsLeaveGuardChange}
        onUpdated={onUpdated}
      />
    );
  }

  if (content?.kind === "publicAddresses") {
    return (
      <EntryPointSettingsPane
        kubeconfig={kubeconfig}
        onClose={onClose}
        onSettingsLeaveGuardChange={onSettingsLeaveGuardChange}
        onUpdated={onUpdated}
        readOnly={readOnly}
        selection={content.selection}
      />
    );
  }

  return null;
}

export function ProjectCanvasResourcePane(
  props: ProjectCanvasResourcePaneContentProps
) {
  return (
    <CanvasResourcePanePresence>
      {renderProjectCanvasResourcePaneContent(props)}
    </CanvasResourcePanePresence>
  );
}
