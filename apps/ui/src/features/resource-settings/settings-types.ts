"use client";

import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { ProjectSideSurfaceEntry } from "@/features/panes/surface-state";
import type { SettingsOwnerTarget } from "@/features/panes/target-identity";
import type { SettingsLaunchContext } from "@/features/project-runtime/settings-launch-context";
import type {
  ApSettingsConfirmedAddDbDsnReference,
  ApSettingsPendingDbReference,
} from "@/features/resource-settings/ap/ap-settings-sections";
import type { ApEnvDbDsnSource } from "@/features/resource-settings/ap/lib/ap-env-rows";
import type { SettingsLeaveGuardHandle } from "@/features/resource-settings/settings-leave-guard";

export type { SettingsLaunchContext } from "@/features/project-runtime/settings-launch-context";

export interface SettingsReadModelHints {
  ap?: {
    dbDsnReferenceSources?: ApEnvDbDsnSource[];
  };
}

export interface SettingsSessionEvents {
  ap?: {
    onAddDbDsnReferenceMutationStart?: (
      references: readonly ApSettingsConfirmedAddDbDsnReference[]
    ) => (() => void) | undefined;
    onPendingDbReferencesChange?: (
      references: readonly ApSettingsPendingDbReference[]
    ) => void;
  };
}

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
  launchContext?: SettingsLaunchContext;
  onClose: () => void;
  onLaunchContextConsumed?: () => void;
  onModelChange: (model: SettingsViewModel | null) => void;
  onRepairSideEntry?: (entry: ProjectSideSurfaceEntry | null) => void;
  onUpdated?: () => Promise<unknown>;
  readModelHints?: SettingsReadModelHints;
  readOnly: boolean;
  sessionEvents?: SettingsSessionEvents;
  target: SettingsOwnerTarget;
  view?: string;
}

export type SettingsProvider = ComponentType<SettingsProviderProps>;
