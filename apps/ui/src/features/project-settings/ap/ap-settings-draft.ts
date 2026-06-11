"use client";

import { type ApNetwork, apNetworksEqual } from "./ap-network-model";
import {
  type ApReplicaStrategy,
  CPU_QUOTA_DIRTY_EPS,
  replicaStrategiesEqual,
} from "./ap-replica-strategy-section";
import type { ApEnvVar, ApSettingsEnvChangeMeta } from "./environment-section";
import { canonicalApEnvRawSource } from "./lib/ap-env-raw-source";
import { apEnvRowsEqual } from "./lib/ap-env-rows";
import type {
  ApConfigMapMount,
  ApStorageMount,
  ApWorkloadKind,
} from "./workload-sections";

let apSettingsDraftKeyCounter = 0;

export interface ApSettingsDraft {
  args?: readonly string[];
  command?: readonly string[];
  configMaps?: readonly ApConfigMapMount[];
  cpuCores: number;
  env: readonly ApEnvVar[];
  envRawSource?: string;
  image: string;
  memoryMib: number;
  network?: ApNetwork;
  replicaStrategy?: ApReplicaStrategy;
  replicas?: number;
  storage?: readonly ApStorageMount[];
  workloadKind?: ApWorkloadKind;
}

export interface ApSettingsDraftCommitMeta
  extends Partial<ApSettingsEnvChangeMeta> {
  baseDraft: ApSettingsDraft;
}

function stringArrayDraftsEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value.trim() === right[index]?.trim());
}

function configMapMountDraftsEqual(
  a: readonly ApConfigMapMount[] | undefined,
  b: readonly ApConfigMapMount[] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => {
    const other = right[index];
    return (
      other != null &&
      value.path.trim() === other.path.trim() &&
      value.value === other.value
    );
  });
}

function storageMountDraftsEqual(
  a: readonly ApStorageMount[] | undefined,
  b: readonly ApStorageMount[] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => {
    const other = right[index];
    return (
      other != null &&
      value.path.trim() === other.path.trim() &&
      value.size.trim() === other.size.trim()
    );
  });
}

function apDraftResourcesDirty(
  original: ApSettingsDraft,
  draft: ApSettingsDraft
): boolean {
  const cpuMemDirty =
    Math.abs(draft.cpuCores - original.cpuCores) > CPU_QUOTA_DIRTY_EPS ||
    Math.round(draft.memoryMib) !== Math.round(original.memoryMib);
  if (cpuMemDirty) {
    return true;
  }
  if (original.replicaStrategy == null || draft.replicaStrategy == null) {
    return original.replicaStrategy !== draft.replicaStrategy;
  }
  return !replicaStrategiesEqual(
    draft.replicaStrategy,
    original.replicaStrategy
  );
}

export function apSettingsDraftIsDirty(
  original: ApSettingsDraft,
  draft: ApSettingsDraft
): boolean {
  const originalEnvRawSource = canonicalApEnvRawSource({
    env: original.env,
    envRawSource: original.envRawSource,
  });
  const draftEnvRawSource = canonicalApEnvRawSource({
    env: draft.env,
    envRawSource: draft.envRawSource,
  });
  return (
    draft.image.trim() !== original.image.trim() ||
    !stringArrayDraftsEqual(draft.command, original.command) ||
    !stringArrayDraftsEqual(draft.args, original.args) ||
    !configMapMountDraftsEqual(draft.configMaps, original.configMaps) ||
    !storageMountDraftsEqual(draft.storage, original.storage) ||
    !apEnvRowsEqual([...draft.env], [...original.env]) ||
    draftEnvRawSource !== originalEnvRawSource ||
    apDraftResourcesDirty(original, draft) ||
    !apNetworksEqual(original.network, draft.network)
  );
}

export function apSettingsDraftBackingKey(draft: ApSettingsDraft) {
  return JSON.stringify(draft);
}

export function apNetworkDraftBackingKey(network: ApNetwork) {
  return JSON.stringify(network);
}

interface ApSettingsDraftValues {
  args?: readonly string[];
  command?: readonly string[];
  configMaps?: readonly ApConfigMapMount[];
  cpuCores: number;
  env: readonly ApEnvVar[];
  envRawSource?: string;
  image: string;
  memoryMib: number;
  network?: ApNetwork;
  replicaStrategy?: ApReplicaStrategy;
  storage?: readonly ApStorageMount[];
  workloadKind?: ApWorkloadKind;
}

export function apSettingsDraftFromValues({
  args,
  command,
  configMaps,
  cpuCores,
  env,
  envRawSource,
  image,
  memoryMib,
  network,
  replicaStrategy,
  storage,
  workloadKind,
}: ApSettingsDraftValues): ApSettingsDraft {
  return {
    ...(args == null ? {} : { args }),
    ...(command == null ? {} : { command }),
    ...(configMaps == null ? {} : { configMaps }),
    cpuCores,
    env,
    envRawSource: canonicalApEnvRawSource({ env, envRawSource }),
    image,
    memoryMib,
    ...(network == null ? {} : { network }),
    ...(replicaStrategy == null
      ? {}
      : {
          replicaStrategy,
          replicas: replicaStrategy.fixed.replicas,
        }),
    ...(storage == null ? {} : { storage }),
    ...(workloadKind == null ? {} : { workloadKind }),
  };
}

export function createDraftRowKey(prefix: string): string {
  apSettingsDraftKeyCounter += 1;
  return `${prefix}-${apSettingsDraftKeyCounter}`;
}

export function createDraftRowKeys(count: number, prefix: string): string[] {
  return Array.from({ length: count }, () => createDraftRowKey(prefix));
}
