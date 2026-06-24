import {
  type ApNetwork,
  apNetworkSaveDraftFromNetwork,
} from "./ap-network-model";
import type { ApReplicaStrategy } from "./ap-replica-strategy-section";
import {
  AP_SETTINGS_DRAFT_DOMAINS,
  type ApSettingsDraft,
  type ApSettingsDraftDomain,
  apSettingsDraftDomainIsDirty,
  apSettingsDraftFromValues,
} from "./ap-settings-draft";
import { envDraftRowsFromRawSource } from "./environment-section";
import { canonicalApEnvRawSource } from "./lib/ap-env-raw-source";
import {
  type ApConfigMapMount,
  type ApStorageMount,
  type ApWorkloadKind,
  normalizeCommandDraftLines,
  normalizeConfigMapDraftRows,
  normalizeStorageDraftRows,
} from "./workload-sections";

export interface ApPendingEnvironmentTarget {
  rawSource: string;
}

export interface ApPendingLaunchTarget {
  args: readonly string[];
  command: readonly string[];
  configMaps: readonly ApConfigMapMount[];
  image: string;
  storage: readonly ApStorageMount[];
  workloadKind?: ApWorkloadKind;
}

export interface ApPendingResourcesTarget {
  cpuCores: number;
  memoryMib: number;
  replicaStrategy?: ApReplicaStrategy;
  replicas?: number;
}

export interface ApPendingSettingsTargets {
  environment?: ApPendingEnvironmentTarget;
  launch?: ApPendingLaunchTarget;
  network?: ApNetwork;
  resources?: ApPendingResourcesTarget;
}

export type ApPendingSettingsTarget =
  ApPendingSettingsTargets[keyof ApPendingSettingsTargets];

function clonePlain<T>(value: T): T {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasTarget<TDomain extends keyof ApPendingSettingsTargets>(
  targets: ApPendingSettingsTargets,
  domain: TDomain
): targets is ApPendingSettingsTargets &
  Required<Pick<ApPendingSettingsTargets, TDomain>> {
  return Object.hasOwn(targets, domain);
}

export function apPendingTargetForDomain(
  domain: ApSettingsDraftDomain,
  draft: ApSettingsDraft
): ApPendingSettingsTarget {
  switch (domain) {
    case "environment":
      return {
        rawSource: canonicalApEnvRawSource({
          env: draft.env,
          envRawSource: draft.envRawSource,
        }),
      };
    case "launch":
      return {
        args: normalizeCommandDraftLines(draft.args),
        command: normalizeCommandDraftLines(draft.command),
        configMaps: clonePlain(normalizeConfigMapDraftRows(draft.configMaps)),
        image: draft.image.trim(),
        storage: clonePlain(normalizeStorageDraftRows(draft.storage)),
        ...(draft.workloadKind == null
          ? {}
          : { workloadKind: draft.workloadKind }),
      };
    case "network":
      return clonePlain(
        draft.network == null
          ? draft.network
          : apNetworkSaveDraftFromNetwork(draft.network)
      );
    case "resources":
      return {
        cpuCores: draft.cpuCores,
        memoryMib: draft.memoryMib,
        ...(draft.replicaStrategy == null
          ? {}
          : { replicaStrategy: clonePlain(draft.replicaStrategy) }),
        ...(draft.replicas == null ? {} : { replicas: draft.replicas }),
      };
    default:
      return domain satisfies never;
  }
}

export function apPendingTargetsForDirtyDomains(
  base: ApSettingsDraft,
  draft: ApSettingsDraft
): ApPendingSettingsTargets {
  const targets: ApPendingSettingsTargets = {};
  for (const domain of AP_SETTINGS_DRAFT_DOMAINS) {
    if (!apSettingsDraftDomainIsDirty(domain, base, draft)) {
      continue;
    }
    targets[domain] = apPendingTargetForDomain(domain, draft) as never;
  }
  return targets;
}

export function apPendingTargetsEqual(
  _domain: ApSettingsDraftDomain,
  left: ApPendingSettingsTarget,
  right: ApPendingSettingsTarget
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyApPendingTargets(
  base: ApSettingsDraft,
  targets: ApPendingSettingsTargets
): ApSettingsDraft {
  const environment = hasTarget(targets, "environment")
    ? {
        env: envDraftRowsFromRawSource(targets.environment.rawSource),
        envRawSource: targets.environment.rawSource,
      }
    : {
        env: base.env,
        envRawSource: base.envRawSource,
      };
  const launch = hasTarget(targets, "launch")
    ? targets.launch
    : {
        args: base.args,
        command: base.command,
        configMaps: base.configMaps,
        image: base.image,
        storage: base.storage,
        workloadKind: base.workloadKind,
      };
  const resources = hasTarget(targets, "resources")
    ? targets.resources
    : {
        cpuCores: base.cpuCores,
        memoryMib: base.memoryMib,
        replicaStrategy: base.replicaStrategy,
      };

  return apSettingsDraftFromValues({
    args: launch.args,
    command: launch.command,
    configMaps: launch.configMaps,
    cpuCores: resources.cpuCores,
    env: environment.env,
    envRawSource: environment.envRawSource,
    image: launch.image,
    memoryMib: resources.memoryMib,
    network: hasTarget(targets, "network") ? targets.network : base.network,
    replicaStrategy: resources.replicaStrategy,
    storage: launch.storage,
    workloadKind: launch.workloadKind,
  });
}
