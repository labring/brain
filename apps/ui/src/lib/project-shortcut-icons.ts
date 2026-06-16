import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import {
  type DeviconKey,
  deviconSrc,
  devicons,
} from "@workspace/ui/assets/devicons";

import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";

interface WorkloadShortcutCandidate {
  createdAt: string;
  iconKey: DeviconKey;
  name: string;
  projectId: string;
}

export type ProjectShortcutIconKeyMap = ReadonlyMap<string, DeviconKey>;

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

function databaseIconKeyFromSpec(spec: Record<string, unknown>): DeviconKey {
  const engine = nonEmptyString(spec.engine)?.toLowerCase();
  if (engine && engine in devicons && engine !== "docker") {
    return engine as DeviconKey;
  }

  return "docker";
}

function compareWorkloadCandidates(
  a: WorkloadShortcutCandidate,
  b: WorkloadShortcutCandidate
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

function selectedApByProject(
  data: K8sGetResponse | undefined
): Map<string, WorkloadShortcutCandidate> {
  const result = new Map<string, WorkloadShortcutCandidate>();

  for (const item of apItemsFromList(data)) {
    const projectId = projectIdFromResource(item);
    if (projectId === undefined) {
      continue;
    }

    const candidate: WorkloadShortcutCandidate = {
      createdAt: metadataCreationTimestamp(item),
      iconKey: "docker",
      name: metadataName(item),
      projectId,
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

function selectedDbByProject(
  data: K8sGetResponse | undefined
): Map<string, WorkloadShortcutCandidate> {
  const result = new Map<string, WorkloadShortcutCandidate>();

  for (const item of apItemsFromList(data)) {
    const projectId = projectIdFromResource(item);
    if (projectId === undefined) {
      continue;
    }

    const spec = asRecord(asRecord(item)?.spec) ?? {};
    const candidate: WorkloadShortcutCandidate = {
      createdAt: metadataCreationTimestamp(item),
      iconKey: databaseIconKeyFromSpec(spec),
      name: metadataName(item),
      projectId,
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

export function projectShortcutIconKeysFromWorkloads({
  aps,
  dbs,
}: {
  aps: K8sGetResponse | undefined;
  dbs: K8sGetResponse | undefined;
}): ProjectShortcutIconKeyMap {
  const apByProject = selectedApByProject(aps);
  const dbByProject = selectedDbByProject(dbs);
  const iconKeys = new Map<string, DeviconKey>();

  for (const [projectId, candidate] of dbByProject) {
    iconKeys.set(projectId, candidate.iconKey);
  }
  for (const [projectId, candidate] of apByProject) {
    iconKeys.set(projectId, candidate.iconKey);
  }

  return iconKeys;
}

export function projectShortcutIconAssetUrls(
  iconKeys: Iterable<DeviconKey>
): string[] {
  const urls = new Set<string>();
  for (const iconKey of iconKeys) {
    const icon = devicons[iconKey];
    urls.add(deviconSrc(icon.original));
    urls.add(deviconSrc(icon.plain));
  }
  return [...urls];
}
