import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import {
  type ContainerEnvDbDsnSource,
  type ContainerEnvDbPrimitiveField,
  type ContainerEnvSecretKeyRef,
  containerEnvDbPrimitiveFieldForSecretKey,
} from "@workspace/ui/lib/container-env-rows";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function primitiveSecretRefsFromStatus(
  status: Record<string, unknown>
): Partial<Record<ContainerEnvDbPrimitiveField, ContainerEnvSecretKeyRef>> {
  const variables = Array.isArray(status.variables) ? status.variables : [];
  const refs: Partial<
    Record<ContainerEnvDbPrimitiveField, ContainerEnvSecretKeyRef>
  > = {};
  const priorityByField = new Map<ContainerEnvDbPrimitiveField, number>();

  for (const item of variables) {
    const variable = asRecord(item);
    const valueFrom = asRecord(variable?.valueFrom);
    const secretKeyRef = asRecord(valueFrom?.secretKeyRef);
    const key = nonEmptyString(secretKeyRef?.key);
    const name = nonEmptyString(secretKeyRef?.name);
    if (key === undefined || name === undefined) {
      continue;
    }
    const match = containerEnvDbPrimitiveFieldForSecretKey(key);
    if (match === undefined) {
      continue;
    }
    const existingPriority = priorityByField.get(match.field);
    if (existingPriority !== undefined && existingPriority <= match.priority) {
      continue;
    }
    refs[match.field] = { key, name };
    priorityByField.set(match.field, match.priority);
  }

  return refs;
}

export function dbDsnReferenceSourceFromDb(
  db: unknown,
  namespaceFallback?: string
): ContainerEnvDbDsnSource | undefined {
  const root = asRecord(db) ?? {};
  const metadata = asRecord(root.metadata) ?? {};
  const status = asRecord(root.status) ?? {};
  const name = nonEmptyString(metadata.name);
  const namespace = nonEmptyString(metadata.namespace) ?? namespaceFallback;
  if (name === undefined || namespace === undefined || namespace === "") {
    return undefined;
  }

  const source: ContainerEnvDbDsnSource = { name, namespace };
  const primitiveSecretRefs = primitiveSecretRefsFromStatus(status);
  if (Object.keys(primitiveSecretRefs).length > 0) {
    source.primitiveSecretRefs = primitiveSecretRefs;
  }
  const privateDsn = nonEmptyString(status.connectionStringPrivate);
  if (privateDsn !== undefined) {
    source.privateDsn = privateDsn;
  }
  const publicDsn = nonEmptyString(status.connectionStringPublic);
  if (publicDsn !== undefined) {
    source.publicDsn = publicDsn;
  }
  return source;
}

export function dbDsnReferenceSourcesFromDbsData(
  dbsData: K8sGetResponse | undefined,
  namespaceFallback?: string
): ContainerEnvDbDsnSource[] {
  return apItemsFromList(dbsData)
    .map((item) => dbDsnReferenceSourceFromDb(item, namespaceFallback))
    .filter(
      (source): source is ContainerEnvDbDsnSource => source !== undefined
    );
}
