export const DEFAULT_DOCKER_APP_LISTENING_PORT = 80;

export interface DockerDeploymentEnvVar {
  name: string;
  value: string;
}

export interface DockerDeploymentConfigMap {
  path: string;
  value: string;
}

export interface DockerDeploymentStorageMount {
  path: string;
  size: string;
}

export interface DockerDeploymentSettings {
  appListeningPort: number;
  args?: string[];
  command?: string[];
  configMaps?: DockerDeploymentConfigMap[];
  env: DockerDeploymentEnvVar[];
  image: string;
  storage?: DockerDeploymentStorageMount[];
}

export type DockerDeploymentValidationField =
  | "appListeningPort"
  | "configMaps"
  | "env"
  | "image"
  | "storage";

export type DockerDeploymentValidationErrorType =
  | "duplicate-env-name"
  | "duplicate-mount-path"
  | "empty-image"
  | "invalid-config-map-path"
  | "invalid-env-name"
  | "invalid-image"
  | "invalid-port"
  | "invalid-storage-path"
  | "invalid-storage-size"
  | "missing-env-name";

export interface DockerDeploymentValidationError {
  field: DockerDeploymentValidationField;
  index?: number;
  message: string;
  type: DockerDeploymentValidationErrorType;
}

export interface DockerDeploymentValidationResult {
  errors: DockerDeploymentValidationError[];
  valid: boolean;
}

const IMAGE_WHITESPACE_RE = /\s/;
const K8S_ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const STORAGE_SIZE_RE = /^\d+(\.\d+)?(Gi|Mi|Ti)$/i;

function isKubernetesEnvName(name: string): boolean {
  return K8S_ENV_NAME_RE.test(name);
}

function validateImage(image: string): DockerDeploymentValidationError | null {
  const trimmed = image.trim();
  if (trimmed === "") {
    return {
      field: "image",
      message: "Docker image is required.",
      type: "empty-image",
    };
  }
  if (IMAGE_WHITESPACE_RE.test(trimmed)) {
    return {
      field: "image",
      message: "Docker image must not contain spaces.",
      type: "invalid-image",
    };
  }
  return null;
}

function validateAppListeningPort(
  appListeningPort: number
): DockerDeploymentValidationError | null {
  if (
    !Number.isInteger(appListeningPort) ||
    appListeningPort < 1 ||
    appListeningPort > 65_535
  ) {
    return {
      field: "appListeningPort",
      message: "App Listening Port must be a TCP port from 1 to 65535.",
      type: "invalid-port",
    };
  }
  return null;
}

function validateEnv(
  rows: readonly DockerDeploymentEnvVar[]
): DockerDeploymentValidationError[] {
  const errors: DockerDeploymentValidationError[] = [];
  const firstIndexByName = new Map<string, number>();

  rows.forEach((row, index) => {
    const name = row.name.trim();
    if (name === "") {
      errors.push({
        field: "env",
        index,
        message: "Environment variable name is required.",
        type: "missing-env-name",
      });
      return;
    }
    if (!isKubernetesEnvName(name)) {
      errors.push({
        field: "env",
        index,
        message:
          "Use letters, digits, underscores, dots, or hyphens; do not start with a digit.",
        type: "invalid-env-name",
      });
      return;
    }
    if (firstIndexByName.has(name)) {
      errors.push({
        field: "env",
        index,
        message: "Environment variable names must be unique.",
        type: "duplicate-env-name",
      });
      return;
    }
    firstIndexByName.set(name, index);
  });

  return errors;
}

function validateConfigMaps(
  rows: readonly DockerDeploymentConfigMap[]
): DockerDeploymentValidationError[] {
  const errors: DockerDeploymentValidationError[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const path = row.path.trim();
    if (path === "") {
      return;
    }
    if (!path.startsWith("/")) {
      errors.push({
        field: "configMaps",
        index,
        message: "Config file path must be absolute.",
        type: "invalid-config-map-path",
      });
      return;
    }
    if (seen.has(path)) {
      errors.push({
        field: "configMaps",
        index,
        message: "Mount paths must be unique.",
        type: "duplicate-mount-path",
      });
      return;
    }
    seen.add(path);
  });
  return errors;
}

function validateStorage(
  rows: readonly DockerDeploymentStorageMount[]
): DockerDeploymentValidationError[] {
  const errors: DockerDeploymentValidationError[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const path = row.path.trim();
    if (path === "") {
      return;
    }
    if (!path.startsWith("/")) {
      errors.push({
        field: "storage",
        index,
        message: "Storage path must be absolute.",
        type: "invalid-storage-path",
      });
      return;
    }
    if (seen.has(path)) {
      errors.push({
        field: "storage",
        index,
        message: "Mount paths must be unique.",
        type: "duplicate-mount-path",
      });
      return;
    }
    seen.add(path);
    if (!STORAGE_SIZE_RE.test(row.size.trim())) {
      errors.push({
        field: "storage",
        index,
        message: "Use a size such as 10Gi, 512Mi, or 1Ti.",
        type: "invalid-storage-size",
      });
    }
  });
  return errors;
}

export function validateDockerDeploymentSettings(
  settings: DockerDeploymentSettings
): DockerDeploymentValidationResult {
  const errors = [
    validateImage(settings.image),
    validateAppListeningPort(settings.appListeningPort),
    ...validateConfigMaps(settings.configMaps ?? []),
    ...validateEnv(settings.env ?? []),
    ...validateStorage(settings.storage ?? []),
  ].filter((error): error is DockerDeploymentValidationError => error != null);

  return { errors, valid: errors.length === 0 };
}

export function normalizeDockerDeploymentSettings(
  settings: DockerDeploymentSettings
): DockerDeploymentSettings {
  return {
    appListeningPort: settings.appListeningPort,
    args: (settings.args ?? []).map((value) => value.trim()).filter(Boolean),
    command: (settings.command ?? [])
      .map((value) => value.trim())
      .filter(Boolean),
    configMaps: (settings.configMaps ?? [])
      .map((row) => ({
        path: row.path.trim(),
        value: row.value,
      }))
      .filter((row) => row.path !== ""),
    env: (settings.env ?? []).map((row) => ({
      name: row.name.trim(),
      value: row.value,
    })),
    image: settings.image.trim(),
    storage: (settings.storage ?? [])
      .map((row) => ({
        path: row.path.trim(),
        size: row.size.trim(),
      }))
      .filter((row) => row.path !== ""),
  };
}
