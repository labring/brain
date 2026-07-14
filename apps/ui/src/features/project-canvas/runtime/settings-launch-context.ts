import type {
  ProjectSideSurfaceEntry,
  ProjectSurfaceSlot,
} from "@/features/panes/surface-state";
import { serializeSettingsOwnerTarget } from "@/features/panes/target-identity";

export type SettingsLaunchSource = "assistant" | "canvas" | "route" | "toolbar";

export interface SettingsPendingDatabaseBindingIntent {
  dbName: string;
  dbNamespace: string;
  id: string;
}

export interface SettingsLaunchContext {
  launchSource: SettingsLaunchSource;
  pendingDatabaseBindingIntent?: SettingsPendingDatabaseBindingIntent;
}

export type SettingsSurfaceEntry = Extract<
  ProjectSideSurfaceEntry,
  { kind: "settings" }
>;

export interface SettingsLaunchContextHandle {
  entry: SettingsSurfaceEntry;
  slot: ProjectSurfaceSlot;
}

export interface SettingsLaunchContextSetInput
  extends SettingsLaunchContextHandle {
  context: SettingsLaunchContext;
}

function normalizedSettingsView(view: string | undefined): string {
  const trimmed = view?.trim();
  return trimmed == null || trimmed === "" ? "full" : trimmed;
}

export function settingsLaunchContextKey({
  entry,
  slot,
}: SettingsLaunchContextHandle): string {
  return [
    slot,
    entry.kind,
    serializeSettingsOwnerTarget(entry.target),
    normalizedSettingsView(entry.view),
  ].join(":");
}

export interface SettingsLaunchContextStore {
  delete(handle: SettingsLaunchContextHandle): void;
  get(handle: SettingsLaunchContextHandle): SettingsLaunchContext | undefined;
  set(input: SettingsLaunchContextSetInput): void;
  setRouteRestored(handle: SettingsLaunchContextHandle): void;
}

export function createSettingsLaunchContextStore(): SettingsLaunchContextStore {
  const contexts = new Map<string, SettingsLaunchContext>();

  return {
    delete(handle) {
      contexts.delete(settingsLaunchContextKey(handle));
    },
    get(handle) {
      return contexts.get(settingsLaunchContextKey(handle));
    },
    set(input) {
      contexts.set(settingsLaunchContextKey(input), input.context);
    },
    setRouteRestored(handle) {
      contexts.set(settingsLaunchContextKey(handle), { launchSource: "route" });
    },
  };
}
