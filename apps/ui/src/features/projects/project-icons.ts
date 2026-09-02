import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import {
  type BrandMarkKey,
  brandMarkKeyForDatabaseEngine,
  brandMarkKeyForImage,
} from "@workspace/ui/assets/brand-marks";

import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";

interface WorkloadIconCandidate {
  createdAt: string;
  iconKey: ProjectIconKey;
  name: string;
}

export type ProjectIconKey = BrandMarkKey | "database";

export type ProjectIconKeyMap = ReadonlyMap<string, ProjectIconKey>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return asRecord(asRecord(value)?.metadata) ?? {};
}

function metadataName(value: unknown): string {
  return nonEmptyString(metadataRecord(value).name) ?? "";
}

function metadataCreationTimestamp(value: unknown): string {
  return nonEmptyString(metadataRecord(value).creationTimestamp) ?? "";
}

function projectIdFromResource(value: unknown): string | undefined {
  const labels = asRecord(metadataRecord(value).labels);
  return nonEmptyString(labels?.[BRAIN_PROJECT_ID_LABEL]);
}

function apIconKeyFromSpec(spec: Record<string, unknown>): ProjectIconKey {
  const image = nonEmptyString(asRecord(spec.input)?.image);
  return brandMarkKeyForImage(image) ?? "docker";
}

function databaseIconKeyFromSpec(
  spec: Record<string, unknown>
): ProjectIconKey {
  return (
    brandMarkKeyForDatabaseEngine(nonEmptyString(spec.engine)) ?? "database"
  );
}

function compareWorkloadCandidates(
  a: WorkloadIconCandidate,
  b: WorkloadIconCandidate
): number {
  const aTime = Date.parse(a.createdAt);
  const bTime = Date.parse(b.createdAt);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);

  if (aValid && bValid && aTime !== bTime) {
    return aTime - bTime;
  }
  if (aValid !== bValid) {
    return aValid ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

function selectedWorkloadByProject(
  data: K8sGetResponse | undefined,
  iconKeyFromSpec: (spec: Record<string, unknown>) => ProjectIconKey
): Map<string, WorkloadIconCandidate> {
  const result = new Map<string, WorkloadIconCandidate>();

  for (const item of apItemsFromList(data)) {
    const projectId = projectIdFromResource(item);
    if (projectId === undefined) {
      continue;
    }

    const spec = asRecord(asRecord(item)?.spec) ?? {};
    const candidate: WorkloadIconCandidate = {
      createdAt: metadataCreationTimestamp(item),
      iconKey: iconKeyFromSpec(spec),
      name: metadataName(item),
    };
    const current = result.get(projectId);
    if (
      current === undefined ||
      compareWorkloadCandidates(candidate, current) < 0
    ) {
      result.set(projectId, candidate);
    }
  }

  return result;
}

export function projectIconKeysFromWorkloads({
  aps,
  dbs,
}: {
  aps: K8sGetResponse | undefined;
  dbs: K8sGetResponse | undefined;
}): ProjectIconKeyMap {
  const apByProject = selectedWorkloadByProject(aps, apIconKeyFromSpec);
  const dbByProject = selectedWorkloadByProject(dbs, databaseIconKeyFromSpec);
  const iconKeys = new Map<string, ProjectIconKey>();

  for (const [projectId, candidate] of dbByProject) {
    iconKeys.set(projectId, candidate.iconKey);
  }
  for (const [projectId, candidate] of apByProject) {
    iconKeys.set(projectId, candidate.iconKey);
  }

  return iconKeys;
}
