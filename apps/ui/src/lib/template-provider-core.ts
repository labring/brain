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
  sourceRepos: string[];
  title: string;
}

export interface TemplateDeploymentResourceSummary {
  name: string;
  resourceType: string;
  uid: string;
}

export type TemplateDeploymentExtraLabels = Record<string, string>;

export interface TemplateDefaultValue {
  type?: string;
  value: string;
}

export interface TemplateSourceInput {
  default?: string;
  description?: string;
  if?: string;
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

interface ProviderLegacyTemplateItem {
  metadata?: {
    name?: unknown;
  };
  spec?: {
    categories?: unknown;
    description?: unknown;
    gitRepo?: unknown;
    icon?: unknown;
    inputs?: unknown;
    i18n?: unknown;
    readme?: unknown;
    title?: unknown;
  };
}

interface ProviderLegacyTemplateResponse {
  code?: unknown;
  data?: unknown;
  error?: unknown;
  message?: unknown;
}

interface ProviderLegacyTemplateI18n {
  description?: unknown;
  gitRepo?: unknown;
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

function providerErrorCandidates(value: unknown, depth = 0): string[] {
  if (depth > 4) {
    return [];
  }
  const direct = stringValue(value);
  if (direct) {
    return [direct];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => providerErrorCandidates(item, depth + 1));
  }
  const raw = objectValue(value);
  if (raw == null) {
    return [];
  }
  return ["error", "message", "detail", "details", "reason", "data", "body"]
    .flatMap((key) => providerErrorCandidates(raw[key], depth + 1))
    .filter((message) => message !== "");
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

function templateI18nSpec(
  value: unknown,
  language: string
): ProviderLegacyTemplateI18n | null {
  const raw = objectValue(value);
  const localized = raw?.[language];
  return objectValue(localized) as ProviderLegacyTemplateI18n | null;
}

function legacyTemplateCatalogItem(
  value: unknown,
  language: string
): TemplateCatalogItem | null {
  if (value == null || typeof value !== "object") {
    return null;
  }
  const item = value as ProviderLegacyTemplateItem;
  const spec = item.spec;
  const name = stringValue(item.metadata?.name);
  if (!name) {
    return null;
  }
  const i18n = templateI18nSpec(spec?.i18n, language);
  const gitRepo = stringValue(i18n?.gitRepo) || stringValue(spec?.gitRepo);
  return {
    args: templateInputs(spec?.inputs),
    category: stringArrayValue(spec?.categories),
    description:
      stringValue(i18n?.description) || stringValue(spec?.description),
    icon: stringValue(i18n?.icon) || stringValue(spec?.icon),
    name,
    readme: stringValue(i18n?.readme) || stringValue(spec?.readme),
    sourceRepos: gitRepo ? [gitRepo] : [],
    title: stringValue(i18n?.title) || stringValue(spec?.title) || name,
  };
}

function legacyTemplateListPayload(body: unknown): unknown[] {
  const wrapped = objectValue(body) as ProviderLegacyTemplateResponse | null;
  const data = objectValue(wrapped?.data);
  const templates = data?.templates;
  return Array.isArray(templates) ? templates : [];
}

function providerErrorMessage(body: unknown, fallback: string) {
  return providerErrorCandidates(body)[0] ?? fallback;
}

function readJsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function templateDeploymentResource(
  value: unknown
): TemplateDeploymentResourceSummary | null {
  const raw = objectValue(value);
  if (raw == null) {
    return null;
  }
  const name = stringValue(raw.name);
  const resourceType = stringValue(raw.resourceType);
  if (!(name && resourceType)) {
    return null;
  }
  return {
    name,
    resourceType,
    uid: stringValue(raw.uid),
  };
}

function templateDeploymentPayload(value: unknown): {
  instanceName: string;
  resources: TemplateDeploymentResourceSummary[];
} | null {
  const raw = objectValue(value);
  if (raw == null) {
    return null;
  }
  const instanceName = stringValue(raw.name);
  if (!instanceName) {
    return null;
  }
  const resources = Array.isArray(raw.resources)
    ? raw.resources
        .map(templateDeploymentResource)
        .filter(
          (item): item is TemplateDeploymentResourceSummary => item != null
        )
    : [];
  return {
    instanceName,
    resources,
  };
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
  const language = input?.language?.trim() || "en";
  const response = await fetch(
    providerUrl("/api/listTemplate", {
      language,
    }),
    { next: { revalidate: 300 } }
  );
  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(providerErrorMessage(body, "Could not load templates."));
  }
  return legacyTemplateListPayload(body)
    .map((item) => legacyTemplateCatalogItem(item, language))
    .filter((item): item is TemplateCatalogItem => item != null);
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

export async function deployTemplateInstance(input: {
  args?: Record<string, string>;
  encodedKubeconfig: string;
  extraLabels?: TemplateDeploymentExtraLabels;
  instanceName: string;
  templateName: string;
}): Promise<{
  instanceName: string;
  resources: TemplateDeploymentResourceSummary[];
}> {
  const response = await fetch(
    providerUrl("/api/v2alpha/templates/instances"),
    {
      body: JSON.stringify({
        args: input.args ?? {},
        extraLabels: input.extraLabels ?? {},
        name: input.instanceName,
        template: input.templateName,
      }),
      headers: {
        Authorization: headerSafeEncodedKubeconfig(input.encodedKubeconfig),
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  );
  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(providerErrorMessage(body, "Could not deploy template."));
  }
  const wrapped = objectValue(body) as ProviderTemplateSourceResponse | null;
  const payload = templateDeploymentPayload(wrapped?.data ?? body);
  if (payload == null) {
    throw new Error("Template provider returned an invalid deploy response.");
  }
  return payload;
}
