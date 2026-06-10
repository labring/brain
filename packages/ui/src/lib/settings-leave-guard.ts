export type SettingsLeaveGuardScope =
  | "ap"
  | "database"
  | "environmentVariables"
  | "publicAddresses";
export type SettingsLeaveGuardAction = "close" | "switch";
export type SettingsLeaveGuardDecision = "discard" | "save" | "stay";

export interface SettingsLeaveGuardHandle {
  canSave?: boolean;
  dirty: boolean;
  discard: () => void;
  save: () => Promise<void> | void;
  scope: SettingsLeaveGuardScope;
}

export type SettingsLeaveGuardRegistration = (
  guard: SettingsLeaveGuardHandle | null
) => void;
