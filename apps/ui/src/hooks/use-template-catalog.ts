"use client";

import type { TemplateDeploymentChoice } from "@workspace/ui/components/template-deployer";
import { useAtomValue } from "jotai";
import useSWR from "swr";
import { desktopLanguageAtom } from "@/store/auth-store";

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

async function fetchTemplateCatalog(
  language: string
): Promise<TemplateDeploymentChoice[]> {
  const searchParams = new URLSearchParams();
  const normalizedLanguage = language.trim();
  if (normalizedLanguage !== "") {
    searchParams.set("language", normalizedLanguage);
  }
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

export function useTemplateCatalog(): {
  error: Error | undefined;
  isLoading: boolean;
  templates: TemplateDeploymentChoice[];
} {
  const language = useAtomValue(desktopLanguageAtom);
  const { data, error, isLoading } = useSWR(
    ["template-catalog", language],
    ([, value]) => fetchTemplateCatalog(value)
  );
  return {
    error,
    isLoading,
    templates: data ?? [],
  };
}
