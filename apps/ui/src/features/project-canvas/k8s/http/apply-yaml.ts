"use client";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import YAML from "yaml";

const DIRECT_PRODUCT_API_VERSION = "brain.io/direct";
const DIRECT_PRODUCT_KINDS = new Set(["AP", "DB"]);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function directProductPath(doc: Record<string, unknown>): string | null {
  if (stringValue(doc.apiVersion) !== DIRECT_PRODUCT_API_VERSION) {
    return null;
  }
  switch (stringValue(doc.kind)) {
    case "AP":
      return API_ROUTES.ap.root;
    case "DB":
      return API_ROUTES.db.root;
    default:
      throw new Error(
        `Unsupported Brain direct product ${stringValue(doc.kind) || "<missing>"}.`
      );
  }
}

function assertNoDirectProductManifest(docs: unknown[]) {
  for (const doc of docs) {
    const objectDoc = objectValue(doc);
    if (
      objectDoc != null &&
      stringValue(objectDoc.apiVersion) === DIRECT_PRODUCT_API_VERSION
    ) {
      throw new Error(
        "Brain direct product manifests must be submitted through AP/DB product APIs, not Kubernetes apply."
      );
    }
  }
}

async function applyProductYaml(input: {
  header: Record<string, string>;
  path: string;
  yaml: string;
}) {
  await fetcher({
    base: ApiUrl(),
    body: { yaml: input.yaml },
    header: input.header,
    method: "PUT",
    path: input.path,
  });
}

export async function applyBrainProductManifest(
  kubeconfig: string,
  yaml: string
): Promise<void> {
  const header = {
    Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
    "Content-Type": "application/json",
  };
  const docs = YAML.parseAllDocuments(yaml)
    .map((doc) => doc.toJS())
    .filter((doc) => doc != null);
  if (docs.length === 0) {
    throw new Error("Brain product manifest is empty.");
  }
  for (const doc of docs) {
    const objectDoc = objectValue(doc);
    if (objectDoc == null) {
      throw new Error("Brain product manifest must be a YAML object.");
    }
    const path = directProductPath(objectDoc);
    if (path == null) {
      const apiVersion = stringValue(objectDoc.apiVersion) || "<missing>";
      const kind = stringValue(objectDoc.kind) || "<missing>";
      throw new Error(
        `Expected Brain direct AP/DB manifest, got ${apiVersion} ${kind}.`
      );
    }
    if (!DIRECT_PRODUCT_KINDS.has(stringValue(objectDoc.kind))) {
      throw new Error(
        `Unsupported Brain direct product ${stringValue(objectDoc.kind) || "<missing>"}.`
      );
    }
    await applyProductYaml({
      header,
      path,
      yaml: YAML.stringify(doc).trimEnd(),
    });
  }
}

/**
 * Applies native Kubernetes YAML through the sealai k8s API (user kubeconfig in `Authorization`).
 */
export async function k8sApplyYaml(
  kubeconfig: string,
  yaml: string
): Promise<void> {
  const header = {
    Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
    "Content-Type": "application/json",
  };
  const docs = YAML.parseAllDocuments(yaml)
    .map((doc) => doc.toJS())
    .filter((doc) => doc != null);
  assertNoDirectProductManifest(docs);

  await fetcher({
    base: ApiUrl(),
    path: API_ROUTES.k8s.apply,
    method: "POST",
    header,
    body: { yaml },
  });
}
