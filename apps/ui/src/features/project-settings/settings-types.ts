"use client";

import type { Node } from "@xyflow/react";
import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import type { SettingsLeaveGuardHandle } from "@/features/project-canvas/panels/settings-leave-guard";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import type { SettingsOwnerTarget } from "@/features/project-surfaces/target-identity";

export type SettingsSourceContext =
  | {
      databaseData?: CanvasDatabaseNodeData;
      entryNode?: Node | null;
      kind: "canvas";
      node?: Node | null;
    }
  | undefined;

export interface SettingsRenderedSection {
  actions?: ReactNode;
  chromeless?: boolean;
  content: ReactNode;
  icon?: LucideIcon;
  id: string;
  title: string;
}

export interface SettingsViewModel {
  closeAriaLabel?: string;
  footer?: ReactNode;
  icon?: ReactNode;
  leaveGuard?: SettingsLeaveGuardHandle | null;
  resolvedView: string;
  sections: SettingsRenderedSection[];
  subtitle?: string;
  title: string;
}

export interface SettingsProviderProps {
  kubeconfig?: string;
  onClose: () => void;
  onModelChange: (model: SettingsViewModel | null) => void;
  onRepairSideEntry?: (entry: ProjectSideSurfaceEntry | null) => void;
  onUpdated?: () => Promise<unknown>;
  readOnly: boolean;
  sourceContext: SettingsSourceContext;
  target: SettingsOwnerTarget;
  view?: string;
}

export type SettingsProvider = ComponentType<SettingsProviderProps>;
