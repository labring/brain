import {
  type ApReplicaStrategy,
  apReplicaStrategyFromResource,
} from "./ap-replica-strategy";
import type { K8sJsonPatchOp } from "./http/json-patch";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function specHasField(
  spec: Record<string, unknown> | undefined,
  field: string
): boolean {
  return spec != null && Object.hasOwn(spec, field);
}

/** `replace` if the key exists on `spec`, otherwise `add` (RFC 6902). */
export function specReplaceOrAdd(
  spec: Record<string, unknown> | undefined,
  field: string,
  value: unknown
): K8sJsonPatchOp {
  if (specHasField(spec, field)) {
    return { op: "replace", path: `/spec/${field}`, value };
  }
  return { op: "add", path: `/spec/${field}`, value };
}

export function readApInput(
  spec: Record<string, unknown>
): Record<string, unknown> {
  return asRecord(spec.input) ?? {};
}

export function readApResource(
  spec: Record<string, unknown>
): Record<string, unknown> {
  return asRecord(spec.resource) ?? {};
}

export function readApImage(spec: Record<string, unknown>): string | undefined {
  const img = readApInput(spec).image;
  return typeof img === "string" && img.trim() !== "" ? img.trim() : undefined;
}

export function readApReplicas(
  spec: Record<string, unknown>
): number | undefined {
  const resource = readApResource(spec);
  const replicaStrategy = asRecord(resource.replicaStrategy);
  const fixed = asRecord(replicaStrategy?.fixed);
  const fixedReplicas = fixed?.replicas;
  if (
    replicaStrategy?.type === "fixed" &&
    typeof fixedReplicas === "number" &&
    Number.isFinite(fixedReplicas)
  ) {
    return fixedReplicas;
  }
  const r = resource.replicas;
  return typeof r === "number" && Number.isFinite(r) ? r : undefined;
}

export function readApReplicaStrategy(
  spec: Record<string, unknown>
): ApReplicaStrategy {
  return apReplicaStrategyFromResource(readApResource(spec));
}

export function readApIsPaused(spec: Record<string, unknown>): boolean {
  return spec.paused === true || readApReplicas(spec) === 0;
}

export function readApCpuLimit(spec: Record<string, unknown>): unknown {
  return asRecord(readApResource(spec).limits)?.cpu;
}

export function readApMemoryLimit(spec: Record<string, unknown>): unknown {
  return asRecord(readApResource(spec).limits)?.memory;
}

export function readApEnv(
  spec: Record<string, unknown>
): unknown[] | undefined {
  const raw = readApInput(spec).env;
  return Array.isArray(raw) ? raw : undefined;
}

function patchNestedFields(
  spec: Record<string, unknown> | undefined,
  parent: "input" | "resource",
  partial: Record<string, unknown>
): K8sJsonPatchOp[] {
  const existing = asRecord(spec?.[parent]);
  if (existing == null) {
    return [{ op: "add", path: `/spec/${parent}`, value: partial }];
  }
  return Object.entries(partial).map(([key, value]) =>
    Object.hasOwn(existing, key)
      ? { op: "replace", path: `/spec/${parent}/${key}`, value }
      : { op: "add", path: `/spec/${parent}/${key}`, value }
  );
}

export function patchOpsForApInput(
  spec: Record<string, unknown> | undefined,
  partial: Record<string, unknown>
): K8sJsonPatchOp[] {
  return patchNestedFields(spec, "input", partial);
}

export function patchOpsForApResource(
  spec: Record<string, unknown> | undefined,
  merge: Record<string, unknown>
): K8sJsonPatchOp[] {
  const current = readApResource(spec ?? {});
  const next: Record<string, unknown> = { ...current, ...merge };
  if (merge.limits != null) {
    next.limits = {
      ...(asRecord(current.limits) ?? {}),
      ...(asRecord(merge.limits) ?? {}),
    };
  }
  if (merge.requests != null) {
    next.requests = {
      ...(asRecord(current.requests) ?? {}),
      ...(asRecord(merge.requests) ?? {}),
    };
  }
  if (asRecord(spec?.resource) != null) {
    return [{ op: "replace", path: "/spec/resource", value: next }];
  }
  return [{ op: "add", path: "/spec/resource", value: next }];
}

const EFFECTIVE_SPEC_KEYS = [
  "ingressAnnotations",
  "paused",
  "projectName",
  "restartRequest",
] as const;

export function patchOpsFromEffectiveSnapshot(
  spec: Record<string, unknown> | undefined,
  snap: Record<string, unknown>
): K8sJsonPatchOp[] {
  const ops: K8sJsonPatchOp[] = [];
  const input = asRecord(snap.input);
  if (input != null) {
    ops.push(...patchOpsForApInput(spec, input));
  }
  const resource = asRecord(snap.resource);
  if (resource != null) {
    ops.push(...patchOpsForApResource(spec, resource));
  }
  for (const key of EFFECTIVE_SPEC_KEYS) {
    if (Object.hasOwn(snap, key)) {
      ops.push(specReplaceOrAdd(spec, key, snap[key]));
    }
  }
  return ops;
}
