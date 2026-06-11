import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type {
  ApNetworkCustomDomain,
  ApNetworkCustomDomainDetail,
  ApNetworkPublicAddress,
} from "@/features/project-settings/ap/ap-settings-sections";

import {
  customDomainBindingIdFromValue,
  platformAddressIdFromValue,
} from "@/features/project-settings/ap/lib/platform-address";

export interface ExistingCustomDomainBinding {
  apRef: string;
  domain: string;
  id?: string;
  namespace: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function metadataRecord(
  resource: unknown
): Record<string, unknown> | undefined {
  return asRecord(asRecord(resource)?.metadata);
}

function specRecord(resource: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(resource)?.spec);
}

function statusRecord(resource: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(resource)?.status);
}

function metadataName(resource: unknown): string {
  return trimString(metadataRecord(resource)?.name);
}

function metadataNamespace(resource: unknown): string {
  return trimString(metadataRecord(resource)?.namespace);
}

function entryPointApRef(resource: unknown): string {
  return trimString(specRecord(resource)?.apRef);
}

export function normalizeCustomDomainName(value: unknown): string {
  return trimString(value).toLowerCase().replace(/\.+$/g, "");
}

function portNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  const text = trimString(value);
  if (text === "") {
    return undefined;
  }
  const parsed = Number(text);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function entryPointTargetRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        return record == null ? [] : [record];
      })
    : [];
}

function publicAddressIdFromValue(value: unknown): string | undefined {
  return (
    platformAddressIdFromValue(value) ?? customDomainBindingIdFromValue(value)
  );
}

function publicAddressStatusFromTargetRecord(
  record: Record<string, unknown>
): Pick<ApNetworkPublicAddress, "status"> | undefined {
  if (publicAddressIdFromValue(record.id) == null) {
    return undefined;
  }
  const status = trimString(record.status);
  if (status === "") {
    return undefined;
  }
  return { status };
}

function lifecycleDetail(
  value: unknown
): ApNetworkCustomDomainDetail | undefined {
  const record = asRecord(value);
  if (record == null) {
    return undefined;
  }
  const status = trimString(record.status);
  const reason = trimString(record.reason);
  const message = trimString(record.message);
  if (status === "" && reason === "" && message === "") {
    return undefined;
  }
  return {
    ...(message === "" ? {} : { message }),
    ...(reason === "" ? {} : { reason }),
    ...(status === "" ? {} : { status }),
  };
}

function customDomainStatusFromRecord(
  record: Record<string, unknown>
): ApNetworkCustomDomain | undefined {
  const id = customDomainBindingIdFromValue(record.id);
  const platformAddressId = platformAddressIdFromValue(
    record.platformAddressId
  );
  const domain = normalizeCustomDomainName(record.domain);
  if (id == null || platformAddressId == null || domain === "") {
    return undefined;
  }

  const cnameTarget = trimString(record.cnameTarget);
  const status = trimString(record.status);
  const targetPort = portNumber(record.targetPort);
  const dns = lifecycleDetail(record.dns);
  const certificate = lifecycleDetail(record.certificate);
  const routing = lifecycleDetail(record.routing);

  return {
    ...(certificate == null ? {} : { certificate }),
    ...(cnameTarget === "" ? {} : { cnameTarget }),
    ...(dns == null ? {} : { dns }),
    domain,
    id,
    platformAddressId,
    ...(routing == null ? {} : { routing }),
    ...(status === "" ? {} : { status }),
    ...(targetPort == null ? {} : { targetPort }),
  };
}

function customDomainRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        return record == null ? [] : [record];
      })
    : [];
}

function entryPointMatchesAp(
  entryPoint: unknown,
  apMetadata: Record<string, unknown>
): boolean {
  const namespace = trimString(apMetadata.namespace);
  const name = trimString(apMetadata.name);
  if (namespace === "" || name === "") {
    return false;
  }
  if (metadataNamespace(entryPoint) !== namespace) {
    return false;
  }
  const apRef = entryPointApRef(entryPoint);
  return apRef === name || (apRef === "" && metadataName(entryPoint) === name);
}

function customDomainBindingsFromRecords(
  source: unknown,
  base: Pick<ExistingCustomDomainBinding, "apRef" | "namespace">
): ExistingCustomDomainBinding[] {
  return customDomainRecords(source).flatMap((record) => {
    const domain = normalizeCustomDomainName(record.domain);
    if (domain === "") {
      return [];
    }
    const id = customDomainBindingIdFromValue(record.id);
    return [
      {
        ...base,
        domain,
        ...(id == null ? {} : { id }),
      },
    ];
  });
}

export function entryPointCustomDomainStatusesForAp(
  data: K8sGetResponse | undefined,
  apMetadata: Record<string, unknown>
): ReadonlyMap<string, ApNetworkCustomDomain> {
  const out = new Map<string, ApNetworkCustomDomain>();
  for (const entryPoint of apItemsFromList(data)) {
    if (!entryPointMatchesAp(entryPoint, apMetadata)) {
      continue;
    }
    for (const record of customDomainRecords(
      statusRecord(entryPoint)?.customDomains
    )) {
      const status = customDomainStatusFromRecord(record);
      if (status != null) {
        out.set(status.id, status);
      }
    }
  }
  return out;
}

export function entryPointPublicAddressStatusesForAp(
  data: K8sGetResponse | undefined,
  apMetadata: Record<string, unknown>
): ReadonlyMap<string, Pick<ApNetworkPublicAddress, "status">> {
  const out = new Map<string, Pick<ApNetworkPublicAddress, "status">>();
  for (const entryPoint of apItemsFromList(data)) {
    if (!entryPointMatchesAp(entryPoint, apMetadata)) {
      continue;
    }
    for (const record of entryPointTargetRecords(
      statusRecord(entryPoint)?.targets
    )) {
      const id = publicAddressIdFromValue(record.id);
      const status = publicAddressStatusFromTargetRecord(record);
      if (id != null && status != null) {
        out.set(id, status);
      }
    }
  }
  return out;
}

export function existingCustomDomainBindingsFromEntryPoints(
  data: K8sGetResponse | undefined
): ExistingCustomDomainBinding[] {
  const out = new Map<string, ExistingCustomDomainBinding>();
  for (const entryPoint of apItemsFromList(data)) {
    const namespace = metadataNamespace(entryPoint);
    const apRef = entryPointApRef(entryPoint) || metadataName(entryPoint);
    if (namespace === "" || apRef === "") {
      continue;
    }

    for (const source of [
      specRecord(entryPoint)?.customDomains,
      statusRecord(entryPoint)?.customDomains,
    ]) {
      for (const binding of customDomainBindingsFromRecords(source, {
        apRef,
        namespace,
      })) {
        const { domain, id } = binding;
        const key = `${namespace}/${apRef}/${id ?? domain}`;
        out.set(key, binding);
      }
    }
  }
  return [...out.values()];
}
