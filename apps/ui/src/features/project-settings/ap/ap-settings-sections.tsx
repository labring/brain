"use client";

/** biome-ignore lint/performance/noBarrelFile: AP Settings keeps this compatibility facade while implementation is split into provider-local modules. */
export { resourceQuotaReplicaPatchFromDraft } from "./ap-replica-strategy-section";
export { apSettingsDraftIsDirty } from "./ap-settings-draft";
export type {
  ApConfigMapMount,
  ApCpuElasticReplicaTarget,
  ApCustomDomainCnameVerificationResult,
  ApCustomDomainCnameVerifier,
  ApElasticReplicaSettings,
  ApElasticReplicaStrategy,
  ApElasticReplicaTarget,
  ApEnvResolvedValueResolver,
  ApEnvVar,
  ApFixedReplicaStrategy,
  ApMemoryElasticReplicaTarget,
  ApNetwork,
  ApNetworkAppListeningPort,
  ApNetworkCustomDomain,
  ApNetworkCustomDomainDetail,
  ApNetworkPlatformAddressDraftContext,
  ApNetworkPublicAddress,
  ApPublicAddressesSettingsDraftCommitMeta,
  ApPublicAddressesSettingsSectionsProps,
  ApReplicaStrategy,
  ApSettingsAddDbDsnReferenceIntent,
  ApSettingsConfirmedAddDbDsnReference,
  ApSettingsControlledQuotaProps,
  ApSettingsDraft,
  ApSettingsDraftCommitMeta,
  ApSettingsEnvChangeMeta,
  ApSettingsPendingDbReference,
  ApSettingsQuotaSliderProps,
  ApSettingsRenderedSection,
  ApSettingsSectionsModel,
  ApSettingsSectionsProps,
  ApStorageMount,
  ApWorkloadKind,
} from "./ap-settings-types";
export {
  confirmedAddDbDsnReferencesFromEnvDraft,
  envRawSourceDraftWithAddReferenceIntent,
  pendingDbReferencesFromEnvRawSourceDraft,
} from "./environment-section";
export {
  apNetworkAfterBindCustomDomain,
  apNetworkAfterEditPublicAddress,
  apNetworkAfterUnbindCustomDomain,
  useApPublicAddressesSettingsSections,
} from "./network-section";
export { useApSettingsSections } from "./use-ap-settings-sections";
