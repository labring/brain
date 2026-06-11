"use client";

import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { ApSettingsSourceData } from "@/features/project-settings/ap/ap-settings-context";
import type { DbSettingsData } from "@/features/project-settings/db/db-settings-types";
import type { SettingsLeaveGuardHandle } from "@/features/project-settings/settings-leave-guard";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import type { SettingsOwnerTarget } from "@/features/project-surfaces/target-identity";

export type SettingsSourceContext =
  | {
      apData?: ApSettingsSourceData;
      databaseData?: DbSettingsData;
      kind: "canvas";
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
