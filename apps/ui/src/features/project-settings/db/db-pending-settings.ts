import {
  DATABASE_SETTINGS_DRAFT_DOMAINS,
  type DatabaseSettingsDraft,
  type DatabaseSettingsDraftDomain,
  dbSettingsDraftDomainIsDirty,
  normalizeDbSettingsCpuLimitCores,
  normalizeDbSettingsMemoryLimitGi,
  normalizeDbSettingsReplicas,
  normalizeDbSettingsStorageGi,
} from "./db-settings-draft";

export interface DbPendingAccessTarget {
  exposeNodePort: boolean;
}

export interface DbPendingResourcesTarget {
  cpuLimitCores: number;
  memoryLimitGi: number;
  replicas: number;
  storageSizeGi: number;
}

export interface DbPendingSettingsTargets {
  access?: DbPendingAccessTarget;
  resources?: DbPendingResourcesTarget;
}

export type DbPendingSettingsTarget =
  DbPendingSettingsTargets[keyof DbPendingSettingsTargets];

function hasTarget<TDomain extends keyof DbPendingSettingsTargets>(
  targets: DbPendingSettingsTargets,
  domain: TDomain
): targets is DbPendingSettingsTargets &
  Required<Pick<DbPendingSettingsTargets, TDomain>> {
  return Object.hasOwn(targets, domain);
}

export function dbPendingTargetForDomain(
  domain: "access",
  draft: DatabaseSettingsDraft
): DbPendingAccessTarget;
export function dbPendingTargetForDomain(
  domain: "resources",
  draft: DatabaseSettingsDraft
): DbPendingResourcesTarget;
export function dbPendingTargetForDomain(
  domain: DatabaseSettingsDraftDomain,
  draft: DatabaseSettingsDraft
): DbPendingSettingsTarget;
export function dbPendingTargetForDomain(
  domain: DatabaseSettingsDraftDomain,
  draft: DatabaseSettingsDraft
): DbPendingSettingsTarget {
  switch (domain) {
    case "access":
      return { exposeNodePort: draft.exposeNodePort };
    case "resources":
      return {
        cpuLimitCores: normalizeDbSettingsCpuLimitCores(draft.cpuLimitCores),
        memoryLimitGi: normalizeDbSettingsMemoryLimitGi(draft.memoryLimitGi),
        replicas: normalizeDbSettingsReplicas(draft.replicas),
        storageSizeGi: normalizeDbSettingsStorageGi(draft.storageSizeGi),
      };
    default:
      return domain satisfies never;
  }
}

export function dbPendingTargetsForDirtyDomains(
  base: DatabaseSettingsDraft,
  draft: DatabaseSettingsDraft
): DbPendingSettingsTargets {
  const targets: DbPendingSettingsTargets = {};
  for (const domain of DATABASE_SETTINGS_DRAFT_DOMAINS) {
    if (!dbSettingsDraftDomainIsDirty(domain, base, draft)) {
      continue;
    }
    targets[domain] = dbPendingTargetForDomain(domain, draft) as never;
  }
  return targets;
}

export function dbPendingTargetsEqual(
  _domain: DatabaseSettingsDraftDomain,
  left: DbPendingSettingsTarget,
  right: DbPendingSettingsTarget
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyDbPendingTargets(
  base: DatabaseSettingsDraft,
  targets: DbPendingSettingsTargets
): DatabaseSettingsDraft {
  const access = hasTarget(targets, "access")
    ? targets.access
    : { exposeNodePort: base.exposeNodePort };
  const resources = hasTarget(targets, "resources")
    ? targets.resources
    : {
        cpuLimitCores: base.cpuLimitCores,
        memoryLimitGi: base.memoryLimitGi,
        replicas: base.replicas,
        storageSizeGi: base.storageSizeGi,
      };

  return {
    cpuLimitCores: resources.cpuLimitCores,
    exposeNodePort: access.exposeNodePort,
    memoryLimitGi: resources.memoryLimitGi,
    replicas: resources.replicas,
    storageSizeGi: resources.storageSizeGi,
  };
}
