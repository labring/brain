export const TEMPLATE_NAME_MAX_LENGTH = 256;

export type TemplateForm = Record<string, string>;

export function normalizeTemplateName(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized !== "" && normalized.length <= TEMPLATE_NAME_MAX_LENGTH
    ? normalized
    : null;
}

export function parseTemplateForm(
  value: string | null | undefined
): TemplateForm | null {
  if (value == null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const entries = Object.entries(parsed);
    if (
      entries.some(
        ([, entryValue]) =>
          typeof entryValue !== "string" &&
          typeof entryValue !== "boolean" &&
          typeof entryValue !== "number"
      )
    ) {
      return null;
    }

    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, String(entryValue)])
    );
  } catch {
    return null;
  }
}
