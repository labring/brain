"use client";

import { SidePane } from "@workspace/ui/components/side-pane";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectSideSurfaceEntry } from "@/features/panes/surface-state";
import type { SettingsOwnerTarget } from "@/features/panes/target-identity";
import type { SettingsLeaveGuardRegistration } from "@/features/resource-settings/settings-leave-guard";
import { ApSettingsProvider } from "./settings-provider-ap";
import { DbSettingsProvider } from "./settings-provider-db";
import type {
  SettingsLaunchContext,
  SettingsProvider,
  SettingsReadModelHints,
  SettingsSessionEvents,
  SettingsViewModel,
} from "./settings-types";

const SETTINGS_PROVIDERS = {
  AP: ApSettingsProvider,
  DB: DbSettingsProvider,
} satisfies Partial<Record<SettingsOwnerTarget["kind"], SettingsProvider>>;

function settingsEntryKey(
  entry: Extract<ProjectSideSurfaceEntry, { kind: "settings" }>
) {
  const { target } = entry;
  return `${target.kind}:${target.namespace}:${target.name}:${entry.view ?? ""}`;
}

type SettingsHostChromeModel = Omit<
  SettingsViewModel,
  "footer" | "leaveGuard" | "sections"
>;

function settingsChromeModelsEqual(
  left: SettingsHostChromeModel | null,
  right: SettingsHostChromeModel | null
) {
  if (left === right) {
    return true;
  }
  if (left == null || right == null) {
    return false;
  }
  return (
    left.closeAriaLabel === right.closeAriaLabel &&
    left.resolvedView === right.resolvedView &&
    left.subtitle === right.subtitle &&
    left.title === right.title
  );
}

export function SettingsHost({
  entry,
  kubeconfig,
  launchContext,
  onClose,
  onLaunchContextConsumed,
  onRepairSideEntry,
  onSettingsLeaveGuardChange,
  onUpdated,
  readModelHints,
  readOnly = false,
  sessionEvents,
}: {
  entry: Extract<ProjectSideSurfaceEntry, { kind: "settings" }>;
  kubeconfig?: string;
  launchContext?: SettingsLaunchContext;
  onClose: () => void;
  onLaunchContextConsumed?: () => void;
  onRepairSideEntry?: (entry: ProjectSideSurfaceEntry | null) => void;
  onSettingsLeaveGuardChange?: SettingsLeaveGuardRegistration;
  onUpdated?: () => Promise<unknown>;
  readModelHints?: SettingsReadModelHints;
  readOnly?: boolean;
  sessionEvents?: SettingsSessionEvents;
}) {
  // Member lookup (not a helper call) so the linter can prove the provider
  // components are module-level statics.
  const Provider = SETTINGS_PROVIDERS[entry.target.kind] ?? null;
  const entryKey = settingsEntryKey(entry);
  const [modelState, setModelState] = useState<{
    key: string;
    model: SettingsHostChromeModel | null;
  }>({ key: "", model: null });
  const leaveGuardRef = useRef<SettingsViewModel["leaveGuard"]>(null);
  const setModel = useCallback(
    (model: SettingsViewModel | null) => {
      const nextGuard = model?.leaveGuard ?? null;
      if (leaveGuardRef.current !== nextGuard) {
        leaveGuardRef.current = nextGuard;
        onSettingsLeaveGuardChange?.(nextGuard);
      }
      setModelState((current) => {
        const next =
          model == null
            ? null
            : {
                closeAriaLabel: model.closeAriaLabel,
                icon: model.icon,
                resolvedView: model.resolvedView,
                subtitle: model.subtitle,
                title: model.title,
              };
        if (
          current.key === entryKey &&
          settingsChromeModelsEqual(current.model, next)
        ) {
          return current;
        }
        return { key: entryKey, model: next };
      });
    },
    [entryKey, onSettingsLeaveGuardChange]
  );
  const model = modelState.key === entryKey ? modelState.model : null;

  useEffect(() => {
    if (Provider != null) {
      return;
    }
    onRepairSideEntry?.(null);
  }, [Provider, onRepairSideEntry]);

  useEffect(() => {
    onSettingsLeaveGuardChange?.(leaveGuardRef.current ?? null);
    return () => {
      leaveGuardRef.current = null;
      onSettingsLeaveGuardChange?.(null);
    };
  }, [onSettingsLeaveGuardChange]);

  if (Provider == null) {
    return null;
  }

  return (
    <SidePane
      closeAriaLabel={model?.closeAriaLabel ?? "Close settings"}
      icon={model?.icon}
      label="Settings pane"
      onClose={onClose}
      subtitle={model?.subtitle}
      title={model?.title ?? "Settings"}
    >
      <Provider
        kubeconfig={kubeconfig}
        launchContext={launchContext}
        onClose={onClose}
        onLaunchContextConsumed={onLaunchContextConsumed}
        onModelChange={setModel}
        onRepairSideEntry={onRepairSideEntry}
        onUpdated={onUpdated}
        readModelHints={readModelHints}
        readOnly={readOnly}
        sessionEvents={sessionEvents}
        target={entry.target}
        view={entry.view}
      />
    </SidePane>
  );
}
