"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type {
  SettingsLeaveGuardHandle,
  SettingsLeaveGuardRegistration,
} from "../settings-leave-guard";
import type {
  ApCustomDomainCnameVerifier,
  ApNetwork,
  ApNetworkPlatformAddressDraftContext,
} from "./ap-network-model";

export interface ApPublicAddressReadiness {
  error?: string;
  ready: boolean;
  url: string;
}

/** Quota sliders are controlled: parent owns `value` and receives `onValueChange`. */
export interface ApSettingsControlledQuotaProps {
  disabled?: boolean;
  max?: number;
  min?: number;
  onValueChange: (value: number) => void;
  /** Radix Slider step (`SettingsSlider.Root` defaults to `0.1` unless set). */
  step?: number;
  value: number;
}

/** @deprecated Prefer {@link ApSettingsControlledQuotaProps}; pane quotas are always controlled. */
export type ApSettingsQuotaSliderProps = ApSettingsControlledQuotaProps;

export interface ApSettingsRenderedSection {
  actions?: ReactNode;
  chromeless?: boolean;
  content: ReactNode;
  icon?: LucideIcon;
  id: string;
  title: string;
}

export interface ApSettingsSectionsModel {
  footer?: ReactNode;
  leaveGuard?: SettingsLeaveGuardHandle | null;
  sections: ApSettingsRenderedSection[];
}

export interface ApPublicAddressesSettingsDraftCommitMeta {
  baseNetwork: ApNetwork;
}

export interface ApPublicAddressesSettingsSectionsProps {
  className?: string;
  identityKey?: string;
  network: ApNetwork;
  networkPlatformAddressDraftContext?: ApNetworkPlatformAddressDraftContext;
  onCustomDomainCnameVerify?: ApCustomDomainCnameVerifier;
  onNetworkDraftCommit?: (
    network: ApNetwork,
    meta: ApPublicAddressesSettingsDraftCommitMeta
  ) => void | Promise<void>;
  onSettingsDraftLeaveGuardChange?: SettingsLeaveGuardRegistration;
  publicAddressReadiness?: readonly ApPublicAddressReadiness[];
  readOnly?: boolean;
}
