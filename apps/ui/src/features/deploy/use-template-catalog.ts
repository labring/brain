"use client";

import useSWR from "swr";
import type { TemplateDeploymentChoice } from "@/features/deploy/template-deployer";

const TEMPLATE_CATALOG_LANGUAGE = "en";

function templatesFromBody(body: unknown): TemplateDeploymentChoice[] {
  if (body == null || typeof body !== "object" || !("templates" in body)) {
    return [];
  }
  const templates = (body as { templates?: unknown }).templates;
  return Array.isArray(templates)
    ? templates.filter(
        (item): item is TemplateDeploymentChoice =>
          item != null &&
          typeof item === "object" &&
          typeof (item as { name?: unknown }).name === "string" &&
          typeof (item as { title?: unknown }).title === "string" &&
          Array.isArray((item as { args?: unknown }).args)
      )
    : [];
}

async function fetchTemplateCatalog(): Promise<TemplateDeploymentChoice[]> {
  const searchParams = new URLSearchParams();
  searchParams.set("language", TEMPLATE_CATALOG_LANGUAGE);
  const response = await fetch(`/api/templates?${searchParams}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body != null &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "Could not load template catalog.";
    throw new Error(message);
  }
  return templatesFromBody(body);
}

export function useTemplateCatalog(options?: { enabled?: boolean }): {
  error: Error | undefined;
  isLoading: boolean;
  templates: TemplateDeploymentChoice[];
} {
  const enabled = options?.enabled ?? true;
  const { data, error, isLoading } = useSWR(
    enabled ? (["template-catalog", TEMPLATE_CATALOG_LANGUAGE] as const) : null,
    () => fetchTemplateCatalog()
  );
  return {
    error,
    isLoading: enabled ? isLoading : false,
    templates: data ?? [],
  };
}
