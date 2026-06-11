import type { ContainerNodeStates } from "@workspace/ui/components/container-node/container-node";
import type {
  ApSettingsAddDbDsnReferenceIntent,
  ApSettingsConfirmedAddDbDsnReference,
  ApSettingsPendingDbReference,
} from "./ap-settings-sections";
import type { ApEnvDbDsnSource } from "./lib/ap-env-rows";

export interface ApSettingsAccess {
  readOnly?: boolean;
}

export interface ApSettingsSourceData extends Record<string, unknown> {
  addDbDsnReferenceIntent?: ApSettingsAddDbDsnReferenceIntent | null;
  dbDsnReferenceSources?: ApEnvDbDsnSource[];
  onAddDbDsnReferenceIntentConsumed?: (id: string) => void;
  onAddDbDsnReferenceMutationStart?: (
    references: readonly ApSettingsConfirmedAddDbDsnReference[]
  ) => (() => void) | undefined;
  onPendingDbReferencesChange?: (
    references: readonly ApSettingsPendingDbReference[]
  ) => void;
  onWorkloadMutation?: () => Promise<unknown>;
  settingsAccess?: ApSettingsAccess;
  states?: ContainerNodeStates;
}

export const AP_SETTINGS_REPLICA_LIMITS = { min: 1, max: 20 } as const;

export function apSettingsSourceDataFromUnknown(
  value: unknown
): ApSettingsSourceData | undefined {
  if (value == null || typeof value !== "object") {
    return undefined;
  }
  return value as ApSettingsSourceData;
}

export function apSettingsStatesFromSource(
  source: ApSettingsSourceData | undefined
): ContainerNodeStates | null {
  return source?.states ?? null;
}
