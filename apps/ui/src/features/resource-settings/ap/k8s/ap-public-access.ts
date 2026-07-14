import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { customDomainBindingIdFromValue } from "@/features/resource-settings/ap/lib/platform-address";

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

export function normalizeCustomDomainName(value: unknown): string {
  return trimString(value).toLowerCase().replace(/\.+$/g, "");
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        return record == null ? [] : [record];
      })
    : [];
}

function inputNetwork(resource: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(specRecord(resource)?.input)?.network);
}

function statusNetwork(resource: unknown): Record<string, unknown> | undefined {
  return asRecord(statusRecord(resource)?.network);
}

function desiredCustomDomainBindings(
  source: unknown,
  base: Pick<ExistingCustomDomainBinding, "apRef" | "namespace">
): ExistingCustomDomainBinding[] {
  return arrayRecords(source).flatMap((record) => {
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

function observedCustomDomainBindings(
  source: unknown,
  base: Pick<ExistingCustomDomainBinding, "apRef" | "namespace">
): ExistingCustomDomainBinding[] {
  return arrayRecords(source).flatMap((record) => {
    const id = customDomainBindingIdFromValue(record.id);
    if (id == null) {
      return [];
    }
    const domain = normalizeCustomDomainName(record.host ?? record.domain);
    if (domain === "") {
      return [];
    }
    return [{ ...base, domain, id }];
  });
}

export function existingCustomDomainBindingsFromAps(
  data: K8sGetResponse | undefined
): ExistingCustomDomainBinding[] {
  const out = new Map<string, ExistingCustomDomainBinding>();
  for (const ap of apItemsFromList(data)) {
    const namespace = metadataNamespace(ap);
    const apRef = metadataName(ap);
    if (namespace === "" || apRef === "") {
      continue;
    }

    for (const binding of [
      ...desiredCustomDomainBindings(inputNetwork(ap)?.customDomains, {
        apRef,
        namespace,
      }),
      ...observedCustomDomainBindings(statusNetwork(ap)?.publicAddresses, {
        apRef,
        namespace,
      }),
    ]) {
      const { domain, id } = binding;
      const key = `${namespace}/${apRef}/${id ?? domain}`;
      out.set(key, binding);
    }
  }
  return [...out.values()];
}
