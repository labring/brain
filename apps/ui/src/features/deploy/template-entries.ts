import YAML from "yaml";
import { BRAIN_DEFAULT_OPEN_PORT_ANNOTATION } from "@/lib/brain-labels";
import { ingressEntryPath } from "./task/ingress-entry-path";
import { templateHeaderFromInlineYaml } from "./template-inline-yaml";

/**
 * Template Entries (ADR 0081): the `spec.entries` a Sealos Template may
 * declare — `open`, the URL the Open control opens after a template
 * deployment, and `share`, the URL the Success Record's share strip shares.
 *
 * Everything here is pure and runs over rendered Kubernetes documents (plain
 * objects), so the same rules serve Brain's own renderer and the template
 * provider's read-back path. Resolution rules:
 *
 * - Open: the declared `entries.open`; else the template's Sealos App CR
 *   (`app.sealos.io/v1` `App`, `spec.data.url`); else nothing here — the
 *   automatic Default Open Port rule takes over downstream.
 * - Share: the declared `entries.share` only. It never falls back to the App
 *   CR URL, which may embed a secret (`#token=`, `/invite/<code>`); the
 *   record falls back to the Open URL instead, and never to one that
 *   carries a fragment.
 * - An entry is kept only when an Ingress of the same deployment serves its
 *   host: Brain never surfaces an address the deployment did not create.
 * - Credentials disqualify any entry. A fragment disqualifies Share only: it
 *   never reaches the server, but a desktop-launcher Open URL (`#token=`)
 *   legitimately carries one.
 */

export interface TemplateDeclaredEntries {
  open?: string;
  share?: string;
}

export interface TemplateEntryUrls {
  open?: string;
  share?: string;
}

/** The Service port an Open URL enters through: the Default Open Port preset. */
export interface TemplateEntryOpenPort {
  port: number;
  serviceName: string;
}

const SEALOS_APP_API_VERSION = "app.sealos.io/v1";
const ENTRY_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
const MAX_ENTRY_URL_LENGTH = 2048;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function portNumber(value: unknown): number | undefined {
  let port = Number.NaN;
  if (typeof value === "number") {
    port = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    port = Number(value);
  }
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? port
    : undefined;
}

/**
 * The raw `spec.entries` strings of a Template, before rendering. The
 * provider hands the template back either as the inline YAML string or as
 * the parsed Template object; both shapes are read, so `spec.entries` is
 * never dropped by a shape mismatch.
 */
export function templateDeclaredEntries(
  templateYaml: unknown
): TemplateDeclaredEntries {
  const template =
    typeof templateYaml === "string"
      ? templateObjectFromInlineYaml(templateYaml)
      : objectValue(templateYaml);
  const spec = objectValue(template?.spec);
  const entries = objectValue(spec?.entries);
  const open = stringValue(entries?.open);
  const share = stringValue(entries?.share);
  return {
    ...(open === undefined ? {} : { open }),
    ...(share === undefined ? {} : { share }),
  };
}

/** The leading Template document of an inline template, or nothing. */
function templateObjectFromInlineYaml(
  yaml: string
): Record<string, unknown> | null {
  try {
    const document = YAML.parseDocument(
      templateHeaderFromInlineYaml(yaml).headerYaml
    );
    return document.errors.length > 0 ? null : objectValue(document.toJS());
  } catch {
    return null;
  }
}

/** Which Template Entry a URL is read as; the fragment rule differs. */
export type TemplateEntryRole = "open" | "share";

/**
 * A declared entry as a usable absolute URL, or nothing. The query string is
 * kept verbatim (a share link may carry one) and credentials are rejected
 * for either role. A fragment never reaches the server, so it disqualifies
 * a Share URL; an Open URL may carry one — the Sealos desktop launcher
 * addresses the App CR presets Open with (`#token=…`) do.
 */
export function templateEntryUrl(
  value: unknown,
  role: TemplateEntryRole
): string | undefined {
  const raw = stringValue(value);
  if (raw === undefined || raw.length > MAX_ENTRY_URL_LENGTH) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    if (
      !ENTRY_PROTOCOLS.has(url.protocol) ||
      url.username !== "" ||
      url.password !== "" ||
      (role === "share" && url.hash !== "") ||
      url.hostname === ""
    ) {
      return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}

function entryHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isIngressDoc(doc: Record<string, unknown>): boolean {
  const apiVersion = stringValue(doc.apiVersion) ?? "";
  return doc.kind === "Ingress" && apiVersion.startsWith("networking.k8s.io/");
}

function isServiceDoc(doc: Record<string, unknown>): boolean {
  return doc.kind === "Service" && (doc.apiVersion ?? "v1") === "v1";
}

function docName(doc: Record<string, unknown>): string | undefined {
  return stringValue(objectValue(doc.metadata)?.name);
}

/** The Sealos App CR URL (`spec.data.url`) a template applies for the desktop. */
export function templateAppUrlFromDocs(
  docs: readonly unknown[]
): string | undefined {
  for (const value of docs) {
    const doc = objectValue(value);
    if (
      doc == null ||
      doc.kind !== "App" ||
      doc.apiVersion !== SEALOS_APP_API_VERSION
    ) {
      continue;
    }
    const url = stringValue(objectValue(objectValue(doc.spec)?.data)?.url);
    if (url !== undefined) {
      return url;
    }
  }
  return undefined;
}

/** Every hostname an Ingress rule of the deployment serves, lower-cased. */
export function templateIngressHostsFromDocs(
  docs: readonly unknown[]
): Set<string> {
  const hosts = new Set<string>();
  for (const value of docs) {
    const doc = objectValue(value);
    if (doc == null || !isIngressDoc(doc)) {
      continue;
    }
    const rules = objectValue(doc.spec)?.rules;
    for (const rule of Array.isArray(rules) ? rules : []) {
      const host = stringValue(objectValue(rule)?.host)?.toLowerCase();
      if (host !== undefined) {
        hosts.add(host);
      }
    }
  }
  return hosts;
}

/**
 * Every Service an Ingress rule of the deployment routes to, by name. The
 * provider's resource summary often lists the Ingresses and no Service, so
 * the read-back path fetches the Services the Ingress backends name.
 */
export function templateIngressServiceNamesFromDocs(
  docs: readonly unknown[]
): Set<string> {
  const names = new Set<string>();
  for (const value of docs) {
    const doc = objectValue(value);
    if (doc == null || !isIngressDoc(doc)) {
      continue;
    }
    const rules = objectValue(doc.spec)?.rules;
    for (const rule of Array.isArray(rules) ? rules : []) {
      const paths = objectValue(objectValue(rule)?.http)?.paths;
      for (const path of Array.isArray(paths) ? paths : []) {
        const service = objectValue(
          objectValue(objectValue(path)?.backend)?.service
        );
        const name = stringValue(service?.name);
        if (name !== undefined) {
          names.add(name);
        }
      }
    }
  }
  return names;
}

/**
 * The Open and Share URLs a deployment declares. `hosts` — the Ingress hosts
 * of the same deployment — gates both: an entry no Ingress serves is dropped.
 */
export function resolveTemplateEntryUrls(input: {
  appUrl?: string;
  declared: TemplateDeclaredEntries;
  hosts: ReadonlySet<string>;
}): TemplateEntryUrls {
  const served = (
    candidate: string | undefined,
    role: TemplateEntryRole
  ): string | undefined => {
    const url = templateEntryUrl(candidate, role);
    if (url === undefined) {
      return undefined;
    }
    const host = entryHostname(url);
    return host !== undefined && input.hosts.has(host) ? url : undefined;
  };
  const open =
    served(input.declared.open, "open") ?? served(input.appUrl, "open");
  const share = served(input.declared.share, "share");
  return {
    ...(open === undefined ? {} : { open }),
    ...(share === undefined ? {} : { share }),
  };
}

interface IngressBackendMatch {
  pathLength: number;
  port: unknown;
  serviceName: string;
}

function ingressBackendsForUrl(
  doc: Record<string, unknown>,
  url: URL
): IngressBackendMatch[] {
  const host = url.hostname.toLowerCase();
  const wantedPath = url.pathname === "" ? "/" : url.pathname;
  const rules = objectValue(doc.spec)?.rules;
  const matches: IngressBackendMatch[] = [];
  for (const ruleValue of Array.isArray(rules) ? rules : []) {
    const rule = objectValue(ruleValue);
    if (stringValue(rule?.host)?.toLowerCase() !== host) {
      continue;
    }
    const paths = objectValue(rule?.http)?.paths;
    for (const pathValue of Array.isArray(paths) ? paths : []) {
      const entry = objectValue(pathValue);
      const path = ingressEntryPath(entry?.path);
      if (path == null || !isPathPrefix(path, wantedPath)) {
        continue;
      }
      const service = objectValue(objectValue(entry?.backend)?.service);
      const serviceName = stringValue(service?.name);
      if (serviceName === undefined) {
        continue;
      }
      matches.push({
        pathLength: path.length,
        port: service?.port,
        serviceName,
      });
    }
  }
  return matches;
}

/** `/admin` is a prefix of `/admin` and `/admin/x`, never of `/administrator`. */
function isPathPrefix(prefix: string, path: string): boolean {
  if (prefix === "/") {
    return true;
  }
  const bare = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return path === bare || path.startsWith(`${bare}/`);
}

function servicePortNumber(
  service: Record<string, unknown>,
  backendPort: unknown
): number | undefined {
  const backend = objectValue(backendPort);
  const number = portNumber(backend?.number);
  const ports = objectValue(service.spec)?.ports;
  const entries = (Array.isArray(ports) ? ports : []).flatMap((value) => {
    const entry = objectValue(value);
    return entry == null ? [] : [entry];
  });
  if (number !== undefined) {
    return entries.some((entry) => portNumber(entry.port) === number)
      ? number
      : undefined;
  }
  const name = stringValue(backend?.name);
  if (name === undefined) {
    return undefined;
  }
  const named = entries.find((entry) => stringValue(entry.name) === name);
  return named === undefined ? undefined : portNumber(named.port);
}

/**
 * The Service port the Open URL enters through: the URL host matched to an
 * Ingress rule host, the rule path that is the longest prefix of the URL
 * path, and that path's backend Service and port (a named port resolved
 * through the Service's own `spec.ports`). Nothing when no rule matches, or
 * when the longest-prefix rule's Service or port cannot be resolved — a
 * shorter rule never stands in for it.
 */
export function templateEntryOpenPort(input: {
  docs: readonly unknown[];
  openUrl: string;
}): TemplateEntryOpenPort | undefined {
  let url: URL;
  try {
    url = new URL(input.openUrl);
  } catch {
    return undefined;
  }
  const records = input.docs.flatMap((value) => {
    const doc = objectValue(value);
    return doc == null ? [] : [doc];
  });
  const matches = records
    .filter(isIngressDoc)
    .flatMap((doc) => ingressBackendsForUrl(doc, url))
    .sort((a, b) => b.pathLength - a.pathLength);
  // Only the longest-prefix rule may name the port. A shorter rule serves a
  // different backend; annotating it would make the AP's Open and the
  // record's Open disagree — the very thing the annotation exists to prevent.
  const longest = matches[0]?.pathLength;
  for (const match of matches) {
    if (match.pathLength !== longest) {
      break;
    }
    const service = records.find(
      (doc) => isServiceDoc(doc) && docName(doc) === match.serviceName
    );
    if (service === undefined) {
      continue;
    }
    const port = servicePortNumber(service, match.port);
    if (port !== undefined) {
      return { port, serviceName: match.serviceName };
    }
  }
  return undefined;
}

/**
 * Writes the Default Open Port preset onto the matched Service document,
 * unless the template already set one. Returns whether the document changed.
 */
export function stampTemplateEntryOpenPort(
  docs: readonly unknown[],
  target: TemplateEntryOpenPort
): boolean {
  for (const value of docs) {
    const doc = objectValue(value);
    if (
      doc == null ||
      !isServiceDoc(doc) ||
      docName(doc) !== target.serviceName
    ) {
      continue;
    }
    const metadata = objectValue(doc.metadata) ?? {};
    doc.metadata = metadata;
    const annotations = objectValue(metadata.annotations) ?? {};
    metadata.annotations = annotations;
    if (
      stringValue(annotations[BRAIN_DEFAULT_OPEN_PORT_ANNOTATION]) !== undefined
    ) {
      return false;
    }
    annotations[BRAIN_DEFAULT_OPEN_PORT_ANNOTATION] = String(target.port);
    return true;
  }
  return false;
}

/**
 * Resolves a template's entries over its rendered documents and presets the
 * Default Open Port on the Service the Open URL enters through. `render`
 * substitutes the template's `${{ }}` expressions; the caller owns the
 * evaluation context. Returns the resolved URLs, or nothing when the
 * template declares no usable entry.
 */
export function applyTemplateEntries(input: {
  declared: TemplateDeclaredEntries;
  docs: readonly unknown[];
  render: (value: string) => string;
}): TemplateEntryUrls | undefined {
  const declared: TemplateDeclaredEntries = {
    ...(input.declared.open === undefined
      ? {}
      : { open: input.render(input.declared.open) }),
    ...(input.declared.share === undefined
      ? {}
      : { share: input.render(input.declared.share) }),
  };
  const entries = resolveTemplateEntryUrls({
    appUrl: templateAppUrlFromDocs(input.docs),
    declared,
    hosts: templateIngressHostsFromDocs(input.docs),
  });
  if (entries.open !== undefined) {
    const target = templateEntryOpenPort({
      docs: input.docs,
      openUrl: entries.open,
    });
    if (target !== undefined) {
      stampTemplateEntryOpenPort(input.docs, target);
    }
  }
  return entries.open === undefined && entries.share === undefined
    ? undefined
    : entries;
}

/**
 * The resolved default values an applied Instance CR carries (`spec.defaults`
 * as the provider rendered them), for re-rendering entries after a provider
 * deployment. A value still holding a `${{ }}` expression was not resolved
 * and is left out, so the Ingress-host gate above drops what it would feed.
 */
export function templateInstanceDefaults(
  instance: unknown
): Record<string, string> {
  const defaults = objectValue(
    objectValue(objectValue(instance)?.spec)?.defaults
  );
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(defaults ?? {})) {
    const value = typeof entry === "string" ? entry : objectValue(entry)?.value;
    if (typeof value === "string" && !value.includes("${{")) {
      out[key] = value;
    }
  }
  return out;
}
