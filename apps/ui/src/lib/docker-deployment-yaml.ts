import YAML from "yaml";
import type {
  DockerDeploymentEnvVar,
  DockerDeploymentSettings,
} from "@/features/deployment/docker-deployment-settings";
import { renderYamlTemplate } from "./render-yaml-template";

const DIRECT_PRODUCT_API_VERSION = "brain.io/direct";

interface RenderDockerDeploymentYamlOptions {
  name: string;
  namespace: string;
  platformAddressId?: string;
  projectName: string;
  routingDomain: string;
  settings: DockerDeploymentSettings;
  template?: string;
}

interface DirectApWorkloadSpec {
  kind: "deployment" | "statefulset";
}

type DirectApSpec = Record<string, unknown> & {
  input: Record<string, unknown>;
  name: string;
  projectId: string;
  workload?: DirectApWorkloadSpec;
};

function baseApManifest(options: RenderDockerDeploymentYamlOptions) {
  return {
    apiVersion: DIRECT_PRODUCT_API_VERSION,
    kind: "AP",
    metadata: {
      name: options.name,
      namespace: options.namespace,
    },
    spec: {},
  };
}

function parseTemplate(template: string | undefined) {
  const trimmed = template?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = YAML.parse(trimmed);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : null;
}

function directEnvRows(
  rows: readonly DockerDeploymentEnvVar[]
): DockerDeploymentEnvVar[] | undefined {
  const env = rows
    .map((row) => ({ name: row.name.trim(), value: row.value }))
    .filter((row) => row.name !== "");
  return env.length === 0 ? undefined : env;
}

function metadataWithRoutingDomain(
  doc: Record<string, unknown>,
  options: RenderDockerDeploymentYamlOptions
) {
  const metadata =
    doc.metadata && typeof doc.metadata === "object"
      ? { ...(doc.metadata as Record<string, unknown>) }
      : {};
  const labels =
    metadata.labels && typeof metadata.labels === "object"
      ? { ...(metadata.labels as Record<string, unknown>) }
      : {};
  const metadataWithoutLabels = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => key !== "labels")
  );
  const labelsWithoutRegion = Object.fromEntries(
    Object.entries(labels).filter(([key]) => key !== "region")
  );
  const routingDomain = options.routingDomain.trim();
  const nextMetadata: Record<string, unknown> = {
    ...metadataWithoutLabels,
    name: options.name,
    namespace: options.namespace,
  };
  const nextLabels = routingDomain
    ? { ...labelsWithoutRegion, region: routingDomain }
    : labelsWithoutRegion;

  if (Object.keys(nextLabels).length > 0) {
    nextMetadata.labels = nextLabels;
  }

  return nextMetadata;
}

function stablePlatformAddressId(input: {
  name: string;
  namespace: string;
  port: number;
}): string {
  const source = `${input.namespace}/${input.name}/${input.port}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 33 + source.charCodeAt(index)) % 2_176_782_336;
  }
  return `pa_${hash.toString(36).padStart(6, "0")}000000`.slice(0, 15);
}

function stablePlatformAddressDomainPrefix(input: {
  name: string;
  namespace: string;
  port: number;
}): string {
  const source = `${input.namespace}/${input.name}/${input.port}/domain-prefix`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 33 + source.charCodeAt(index)) % 308_915_776;
  }
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let index = 0; index < 6; index += 1) {
    out += alphabet[hash % alphabet.length];
    hash = Math.floor(hash / alphabet.length);
  }
  return out;
}

export function renderDockerDeploymentYaml(
  options: RenderDockerDeploymentYamlOptions
): string {
  const template =
    options.template == null
      ? undefined
      : renderYamlTemplate(options.template, {
          image: options.settings.image,
          name: options.name,
          namespace: options.namespace,
          region: options.routingDomain,
        });
  const doc = parseTemplate(template) ?? baseApManifest(options);
  doc.apiVersion = DIRECT_PRODUCT_API_VERSION;
  doc.kind = "AP";
  doc.metadata = metadataWithRoutingDomain(doc, options);

  const spec =
    doc.spec && typeof doc.spec === "object"
      ? { ...(doc.spec as Record<string, unknown>) }
      : {};
  const input =
    spec.input && typeof spec.input === "object"
      ? { ...(spec.input as Record<string, unknown>) }
      : {};
  const inputWithoutManagedFields = Object.fromEntries(
    Object.entries(input).filter(
      ([key]) =>
        key !== "args" &&
        key !== "command" &&
        key !== "configMap" &&
        key !== "configMaps" &&
        key !== "env" &&
        key !== "storage"
    )
  );
  const network =
    input.network && typeof input.network === "object"
      ? { ...(input.network as Record<string, unknown>) }
      : {};
  const appListeningPort = options.settings.appListeningPort;
  network.privatePort = undefined;

  const nextInput: Record<string, unknown> = {
    ...inputWithoutManagedFields,
    image: options.settings.image.trim(),
    network: {
      ...network,
      appListeningPorts: [{ port: appListeningPort }],
      platformAddresses: [
        {
          domainPrefix: stablePlatformAddressDomainPrefix({
            name: options.name,
            namespace: options.namespace,
            port: appListeningPort,
          }),
          id:
            options.platformAddressId ??
            stablePlatformAddressId({
              name: options.name,
              namespace: options.namespace,
              port: appListeningPort,
            }),
          port: appListeningPort,
        },
      ],
    },
  };
  const env = directEnvRows(options.settings.env);
  if (env !== undefined) {
    nextInput.env = env;
  }
  const command = options.settings.command ?? [];
  const args = options.settings.args ?? [];
  if (command.length > 0) {
    nextInput.command = command;
  }
  if (args.length > 0) {
    nextInput.args = args;
  }
  const configMaps = (options.settings.configMaps ?? [])
    .map((row) => ({ path: row.path.trim(), value: row.value }))
    .filter((row) => row.path !== "");
  if (configMaps.length > 0) {
    nextInput.configMaps = configMaps;
  }
  const storage = (options.settings.storage ?? [])
    .map((row) => ({ path: row.path.trim(), size: row.size.trim() }))
    .filter((row) => row.path !== "");
  if (storage.length > 0) {
    nextInput.storage = storage;
  }

  const nextSpec: DirectApSpec = {
    ...spec,
    input: nextInput,
    name: options.name,
    projectId: options.projectName,
  };
  if (storage.length > 0) {
    nextSpec.workload = { kind: "statefulset" };
  } else if ("workload" in nextSpec) {
    nextSpec.workload = undefined;
  }
  doc.spec = Object.fromEntries(
    Object.entries(nextSpec).filter(
      ([key, value]) =>
        key !== "legacyRuntime" && key !== "projectName" && value !== undefined
    )
  );

  return YAML.stringify(doc).trimEnd();
}
