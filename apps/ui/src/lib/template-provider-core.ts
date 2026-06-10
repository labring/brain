import { headerSafeEncodedKubeconfig } from "./kubeconfig-header";

export interface TemplateCatalogInput {
  default?: string;
  description: string;
  key: string;
  required: boolean;
  type: string;
}

export interface TemplateCatalogItem {
  args: TemplateCatalogInput[];
  category: string[];
  description: string;
  icon: string;
  name: string;
  readme: string;
  title: string;
}

export interface TemplateDeploymentResourceSummary {
  name: string;
  resourceType: string;
  uid: string;
}

export interface TemplateDefaultValue {
  type?: string;
  value: string;
}

export interface TemplateSourceInput {
  default?: string;
  description?: string;
  key: string;
  label?: string;
  options?: string[];
  required?: boolean;
  type?: string;
}

export interface TemplateSourcePayload {
  appYaml: string;
  source: {
    defaults?: Record<string, TemplateDefaultValue>;
    inputs?: TemplateSourceInput[];
    [key: string]: unknown;
  };
  templateYaml: unknown;
}

interface ProviderTemplateInput {
  default?: unknown;
  description?: unknown;
  required?: unknown;
  type?: unknown;
}

interface ProviderTemplateItem {
  args?: unknown;
  category?: unknown;
  description?: unknown;
  icon?: unknown;
  name?: unknown;
  readme?: unknown;
  title?: unknown;
}

interface ProviderTemplateSourceResponse {
  code?: unknown;
  data?: unknown;
  error?: unknown;
  message?: unknown;
}

const TRAILING_SLASH_RE = /\/+$/;

function providerBaseUrl(): string {
  return (
    process.env.TEMPLATE_PROVIDER_URL?.trim().replace(TRAILING_SLASH_RE, "") ??
    ""
  );
}

function providerUrl(path: string, params?: Record<string, string>) {
  const base = providerBaseUrl();
  if (!base) {
    throw new Error("TEMPLATE_PROVIDER_URL is not configured.");
  }
  const url = new URL(path, `${base}/`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function inputDefaultValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  return String(value);
}

function templateInputs(value: unknown): TemplateCatalogInput[] {
  const inputs =
    value != null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, ProviderTemplateInput>)
      : {};
  return Object.entries(inputs).map(([key, input]) => ({
    ...(inputDefaultValue(input.default) === undefined
      ? {}
      : { default: inputDefaultValue(input.default) }),
    description: stringValue(input.description),
    key,
    required: input.required === true,
    type: stringValue(input.type) || "string",
  }));
}

function templateCatalogItem(value: unknown): TemplateCatalogItem | null {
  if (value == null || typeof value !== "object") {
    return null;
  }
  const item = value as ProviderTemplateItem;
  const name = stringValue(item.name);
  if (!name) {
    return null;
  }
  return {
    args: templateInputs(item.args),
    category: stringArrayValue(item.category),
    description: stringValue(item.description),
    icon: stringValue(item.icon),
    name,
    readme: stringValue(item.readme),
    title: stringValue(item.title) || name,
  };
}

function providerErrorMessage(body: unknown, fallback: string) {
  if (body != null && typeof body === "object") {
    const error = stringValue((body as { error?: unknown }).error);
    const message = stringValue((body as { message?: unknown }).message);
    return error || message || fallback;
  }
  return fallback;
}

function readJsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function templateSourcePayload(value: unknown): TemplateSourcePayload | null {
  const raw = objectValue(value);
  if (raw == null) {
    return null;
  }
  const appYaml = stringValue(raw.appYaml);
  const source = objectValue(raw.source);
  if (!appYaml || source == null || raw.templateYaml == null) {
    return null;
  }
  return {
    appYaml,
    source: source as TemplateSourcePayload["source"],
    templateYaml: raw.templateYaml,
  };
}

export async function listTemplateCatalog(input?: {
  language?: string;
}): Promise<TemplateCatalogItem[]> {
  const response = await fetch(
    providerUrl("/api/v2alpha/templates", {
      language: input?.language?.trim() ?? "en",
    }),
    { cache: "no-store" }
  );
  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(providerErrorMessage(body, "Could not load templates."));
  }
  return Array.isArray(body)
    ? body
        .map(templateCatalogItem)
        .filter((item): item is TemplateCatalogItem => item != null)
    : [];
}

export async function getTemplateSource(input: {
  encodedKubeconfig: string;
  language?: string;
  templateName: string;
}): Promise<TemplateSourcePayload> {
  const response = await fetch(
    providerUrl("/api/getTemplateSource", {
      includeReadme: "false",
      locale: input.language?.trim() ?? "en",
      templateName: input.templateName,
    }),
    {
      headers: {
        Authorization: headerSafeEncodedKubeconfig(input.encodedKubeconfig),
      },
      method: "GET",
    }
  );
  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      providerErrorMessage(body, "Could not load template source.")
    );
  }
  const wrapped = objectValue(body) as ProviderTemplateSourceResponse | null;
  const statusCode =
    typeof wrapped?.code === "number" ? wrapped.code : undefined;
  if (statusCode !== undefined && statusCode !== 200 && statusCode !== 20_000) {
    throw new Error(
      providerErrorMessage(wrapped, "Could not load template source.")
    );
  }
  const payload = templateSourcePayload(wrapped?.data ?? body);
  if (payload == null) {
    throw new Error("Template provider returned an invalid source response.");
  }
  return payload;
}
