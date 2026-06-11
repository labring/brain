import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import {
  type ApEnvDbDsnSource,
  type ApEnvDbPrimitiveField,
  type ApEnvDbReferenceVariable,
  type ApEnvSecretKeyRef,
  apEnvDbPrimitiveFieldForSecretKey,
} from "@/features/project-settings/ap/lib/ap-env-rows";

export type ApEnvironmentDbReferenceSource = ApEnvDbDsnSource;

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
): Partial<Record<ApEnvDbPrimitiveField, ApEnvSecretKeyRef>> {
  const variables = Array.isArray(status.variables) ? status.variables : [];
  const refs: Partial<Record<ApEnvDbPrimitiveField, ApEnvSecretKeyRef>> = {};
  const priorityByField = new Map<ApEnvDbPrimitiveField, number>();

  for (const item of variables) {
    const variable = asRecord(item);
    const valueFrom = asRecord(variable?.valueFrom);
    const secretKeyRef = asRecord(valueFrom?.secretKeyRef);
    const key = nonEmptyString(secretKeyRef?.key);
    const name = nonEmptyString(secretKeyRef?.name);
    if (key === undefined || name === undefined) {
      continue;
    }
    const match = apEnvDbPrimitiveFieldForSecretKey(key);
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

function variablesFromStatus(
  status: Record<string, unknown>
): ApEnvDbReferenceVariable[] {
  const variables = Array.isArray(status.variables) ? status.variables : [];
  const out: ApEnvDbReferenceVariable[] = [];
  for (const item of variables) {
    const variable = asRecord(item);
    const name = nonEmptyString(variable?.name);
    if (name === undefined) {
      continue;
    }
    const valueFrom = asRecord(variable?.valueFrom);
    const secretKeyRef = asRecord(valueFrom?.secretKeyRef);
    const secretName = nonEmptyString(secretKeyRef?.name);
    const secretKey = nonEmptyString(secretKeyRef?.key);
    if (secretName !== undefined && secretKey !== undefined) {
      out.push({
        name,
        type: "secret",
        valueFrom: { secretKeyRef: { key: secretKey, name: secretName } },
      });
      continue;
    }
    const value = nonEmptyString(variable?.value);
    if (value !== undefined) {
      out.push({ name, type: "value", value });
    }
  }
  return out;
}

export function dbDsnReferenceSourceFromDb(
  db: unknown,
  namespaceFallback?: string
): ApEnvDbDsnSource | undefined {
  const root = asRecord(db) ?? {};
  const metadata = asRecord(root.metadata) ?? {};
  const status = asRecord(root.status) ?? {};
  const name = nonEmptyString(metadata.name);
  const namespace = nonEmptyString(metadata.namespace) ?? namespaceFallback;
  if (name === undefined || namespace === undefined || namespace === "") {
    return undefined;
  }

  const source: ApEnvDbDsnSource = { name, namespace };
  const engine = nonEmptyString(asRecord(root.spec)?.engine);
  if (engine !== undefined) {
    source.engine = engine;
  }
  const primitiveSecretRefs = primitiveSecretRefsFromStatus(status);
  if (Object.keys(primitiveSecretRefs).length > 0) {
    source.primitiveSecretRefs = primitiveSecretRefs;
  }
  const variables = variablesFromStatus(status);
  if (variables.length > 0) {
    source.variables = variables;
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
): ApEnvironmentDbReferenceSource[] {
  return apItemsFromList(dbsData)
    .map((item) => dbDsnReferenceSourceFromDb(item, namespaceFallback))
    .filter((source): source is ApEnvDbDsnSource => source !== undefined);
}

export const apEnvironmentDbReferenceSourcesFromDbsData =
  dbDsnReferenceSourcesFromDbsData;
