"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";
import { appFieldFocusClass } from "@workspace/ui/lib/field-state";
import { cn } from "@workspace/ui/lib/utils";
import {
  HardDrive,
  Network,
  Package,
  Plus,
  Rocket,
  ScrollText,
  Settings2,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { StorageSizeInput } from "@/components/storage-size-input";
import { DeploymentSettings } from "./deployment-settings";
import {
  DEFAULT_DOCKER_APP_LISTENING_PORT,
  type DockerDeploymentConfigMap,
  type DockerDeploymentEnvVar,
  type DockerDeploymentSettings,
  type DockerDeploymentStorageMount,
  normalizeDockerDeploymentSettings,
  validateDockerDeploymentSettings,
} from "./docker-deployment-settings";

export type {
  DockerDeploymentEnvVar,
  DockerDeploymentSettings,
} from "./docker-deployment-settings";

interface DockerDeploymentEnvRowState extends DockerDeploymentEnvVar {
  id: string;
}

interface DockerDeploymentConfigMapRowState extends DockerDeploymentConfigMap {
  id: string;
}

interface DockerDeploymentStorageRowState extends DockerDeploymentStorageMount {
  id: string;
}

let envRowIdSequence = 0;
let configMapRowIdSequence = 0;
let storageRowIdSequence = 0;

function createEnvRowId(): string {
  envRowIdSequence += 1;
  return `docker-env-${envRowIdSequence}`;
}

function createConfigMapRowId(): string {
  configMapRowIdSequence += 1;
  return `docker-config-map-${configMapRowIdSequence}`;
}

function createStorageRowId(): string {
  storageRowIdSequence += 1;
  return `docker-storage-${storageRowIdSequence}`;
}

function nextEnvName(rows: readonly DockerDeploymentEnvRowState[]): string {
  const used = new Set(rows.map((row) => row.name.trim()).filter(Boolean));
  if (!used.has("NEW_VARIABLE")) {
    return "NEW_VARIABLE";
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `NEW_VARIABLE_${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

function envErrorForIndex(
  validation: ReturnType<typeof validateDockerDeploymentSettings>,
  index: number
) {
  return validation.errors.find(
    (error) => error.field === "env" && error.index === index
  );
}

function rowErrorForIndex(
  validation: ReturnType<typeof validateDockerDeploymentSettings>,
  field: "configMaps" | "storage",
  index: number
) {
  return validation.errors.find(
    (error) => error.field === field && error.index === index
  );
}

function splitCommandLine(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function AppTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      className={cn(
        "min-h-20 border-input bg-transparent text-foreground text-sm placeholder:text-muted-foreground dark:bg-transparent",
        appFieldFocusClass,
        className
      )}
      {...props}
    />
  );
}

export function DockerDeployer({
  busy = false,
  childrenBeforeDeploy,
  className,
  deployLabel = "Deploy",
  initialSettings,
  onDeploy,
  onSettingsChange,
}: {
  busy?: boolean;
  childrenBeforeDeploy?: ReactNode;
  className?: string;
  deployLabel?: string;
  initialSettings?: DockerDeploymentSettings;
  onDeploy?: (settings: DockerDeploymentSettings) => void | Promise<void>;
  onSettingsChange?: (settings: DockerDeploymentSettings) => void;
}) {
  const [image, setImage] = useState(initialSettings?.image ?? "");
  const [commandText, setCommandText] = useState(
    initialSettings?.command?.join("\n") ?? ""
  );
  const [argsText, setArgsText] = useState(
    initialSettings?.args?.join("\n") ?? ""
  );
  const [imageTouched, setImageTouched] = useState(false);
  const [configMapRows, setConfigMapRows] = useState<
    DockerDeploymentConfigMapRowState[]
  >(
    () =>
      initialSettings?.configMaps?.map((row) => ({
        ...row,
        id: createConfigMapRowId(),
      })) ?? []
  );
  const [envRows, setEnvRows] = useState<DockerDeploymentEnvRowState[]>(
    () =>
      initialSettings?.env.map((row) => ({
        ...row,
        id: createEnvRowId(),
      })) ?? []
  );
  const [appListeningPort, setAppListeningPort] = useState(
    String(
      initialSettings?.appListeningPort ?? DEFAULT_DOCKER_APP_LISTENING_PORT
    )
  );
  const [storageRows, setStorageRows] = useState<
    DockerDeploymentStorageRowState[]
  >(
    () =>
      initialSettings?.storage?.map((row) => ({
        ...row,
        id: createStorageRowId(),
      })) ?? []
  );

  const settings = useMemo<DockerDeploymentSettings>(
    () => ({
      appListeningPort: Number(appListeningPort),
      args: splitCommandLine(argsText),
      command: splitCommandLine(commandText),
      configMaps: configMapRows.map((row) => ({
        path: row.path,
        value: row.value,
      })),
      env: envRows.map((row) => ({ name: row.name, value: row.value })),
      image,
      storage: storageRows.map((row) => ({ path: row.path, size: row.size })),
    }),
    [
      appListeningPort,
      argsText,
      commandText,
      configMapRows,
      envRows,
      image,
      storageRows,
    ]
  );
  const validation = useMemo(
    () => validateDockerDeploymentSettings(settings),
    [settings]
  );
  const imageError = validation.errors.find((error) => error.field === "image");
  const visibleImageError =
    imageTouched || image.trim() !== "" ? imageError : undefined;
  const portError = validation.errors.find(
    (error) => error.field === "appListeningPort"
  );
  const canDeploy = !busy && validation.valid && onDeploy != null;

  useEffect(() => {
    onSettingsChange?.(settings);
  }, [onSettingsChange, settings]);

  return (
    <div
      className={cn("dark flex min-w-0 flex-col gap-3.5", className)}
      data-slot="docker-deployer"
    >
      <div className="flex min-w-0 flex-col gap-3.5">
        <DeploymentSettings.Section
          description="Choose the container image to run."
          icon={<Package aria-hidden className="size-4" />}
          title="Image"
        >
          <DeploymentSettings.Control>
            <AppInput
              aria-describedby={
                visibleImageError ? "docker-deployer-image-error" : undefined
              }
              aria-invalid={visibleImageError ? true : undefined}
              aria-label="Docker image"
              autoComplete="off"
              disabled={busy}
              id="docker-deployer-image"
              onChange={(event) => {
                setImageTouched(true);
                setImage(event.currentTarget.value);
              }}
              placeholder="ghcr.io/org/image:tag"
              value={image}
            />
            {visibleImageError ? (
              <p
                className="text-destructive text-xs leading-4"
                id="docker-deployer-image-error"
                role="alert"
              >
                {visibleImageError.message}
              </p>
            ) : null}
          </DeploymentSettings.Control>
        </DeploymentSettings.Section>

        <DeploymentSettings.Section
          description="Override the image default startup process."
          icon={<TerminalSquare aria-hidden className="size-4" />}
          title="Launch"
        >
          <div className="grid min-w-0 grid-cols-1 gap-3.5">
            <DeploymentSettings.Field label="Command">
              <AppTextarea
                aria-label="Launch command"
                disabled={busy}
                onChange={(event) => setCommandText(event.currentTarget.value)}
                placeholder="/app/server"
                value={commandText}
              />
            </DeploymentSettings.Field>
            <DeploymentSettings.Field label="Args">
              <AppTextarea
                aria-label="Launch args"
                disabled={busy}
                onChange={(event) => setArgsText(event.currentTarget.value)}
                placeholder={"--config\n/etc/app/config.yaml"}
                value={argsText}
              />
            </DeploymentSettings.Field>
          </div>
        </DeploymentSettings.Section>

        <DeploymentSettings.Section
          action={
            <AppButton
              aria-label="Add environment variable"
              disabled={busy}
              onClick={() =>
                setEnvRows((rows) => [
                  ...rows,
                  {
                    id: createEnvRowId(),
                    name: nextEnvName(rows),
                    value: "",
                  },
                ])
              }
              size="default"
              type="button"
              variant="secondary"
            >
              <Plus aria-hidden />
              Add
            </AppButton>
          }
          description="Set direct environment variables for startup."
          icon={<Settings2 aria-hidden className="size-4" />}
          title="Runtime"
        >
          {envRows.length === 0 ? null : (
            <div
              className="flex min-w-0 flex-col gap-2"
              data-slot="docker-env-rows"
            >
              {envRows.map((row, index) => {
                const rowError = envErrorForIndex(validation, index);
                return (
                  <div
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2.5"
                    key={row.id}
                  >
                    <AppInput
                      aria-invalid={rowError ? true : undefined}
                      aria-label={`Environment variable ${index + 1} name`}
                      disabled={busy}
                      onChange={(event) => {
                        const nextName = event.currentTarget.value;
                        setEnvRows((rows) =>
                          rows.map((current, rowIndex) =>
                            rowIndex === index
                              ? { ...current, name: nextName }
                              : current
                          )
                        );
                      }}
                      placeholder="NAME"
                      value={row.name}
                    />
                    <AppInput
                      aria-label={`Environment variable ${index + 1} value`}
                      disabled={busy}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        setEnvRows((rows) =>
                          rows.map((current, rowIndex) =>
                            rowIndex === index
                              ? { ...current, value: nextValue }
                              : current
                          )
                        );
                      }}
                      placeholder="value"
                      value={row.value}
                    />
                    <AppIconButton
                      aria-label="Remove environment variable"
                      disabled={busy}
                      onClick={() =>
                        setEnvRows((rows) =>
                          rows.filter((_, rowIndex) => rowIndex !== index)
                        )
                      }
                      size="lg"
                      type="button"
                      variant="danger"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </AppIconButton>
                    {rowError ? (
                      <p className="col-span-3 text-destructive text-xs leading-4">
                        {rowError.message}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </DeploymentSettings.Section>

        <DeploymentSettings.Section
          action={
            <AppButton
              aria-label="Add config file"
              disabled={busy}
              onClick={() =>
                setConfigMapRows((rows) => [
                  ...rows,
                  {
                    id: createConfigMapRowId(),
                    path: "/etc/app/config.yaml",
                    value: "",
                  },
                ])
              }
              size="default"
              type="button"
              variant="secondary"
            >
              <Plus aria-hidden />
              Add
            </AppButton>
          }
          description="Mount file contents into the container."
          icon={<ScrollText aria-hidden className="size-4" />}
          title="Config Files"
        >
          {configMapRows.length === 0 ? null : (
            <div className="flex min-w-0 flex-col gap-2">
              {configMapRows.map((row, index) => {
                const rowError = rowErrorForIndex(
                  validation,
                  "configMaps",
                  index
                );
                return (
                  <div
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2.5"
                    key={row.id}
                  >
                    <AppInput
                      aria-invalid={rowError ? true : undefined}
                      aria-label={`Config file ${index + 1} path`}
                      disabled={busy}
                      onChange={(event) => {
                        const path = event.currentTarget.value;
                        setConfigMapRows((rows) =>
                          rows.map((current, rowIndex) =>
                            rowIndex === index ? { ...current, path } : current
                          )
                        );
                      }}
                      placeholder="/etc/app/config.yaml"
                      value={row.path}
                    />
                    <AppTextarea
                      aria-label={`Config file ${index + 1} value`}
                      disabled={busy}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setConfigMapRows((rows) =>
                          rows.map((current, rowIndex) =>
                            rowIndex === index ? { ...current, value } : current
                          )
                        );
                      }}
                      placeholder="file contents"
                      value={row.value}
                    />
                    <AppIconButton
                      aria-label="Remove config file"
                      disabled={busy}
                      onClick={() =>
                        setConfigMapRows((rows) =>
                          rows.filter((_, rowIndex) => rowIndex !== index)
                        )
                      }
                      size="lg"
                      type="button"
                      variant="danger"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </AppIconButton>
                    {rowError ? (
                      <p className="col-span-3 text-destructive text-xs leading-4">
                        {rowError.message}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </DeploymentSettings.Section>

        <DeploymentSettings.Section
          action={
            <AppButton
              aria-label="Add storage mount"
              disabled={busy}
              onClick={() =>
                setStorageRows((rows) => [
                  ...rows,
                  { id: createStorageRowId(), path: "/data", size: "1Gi" },
                ])
              }
              size="default"
              type="button"
              variant="secondary"
            >
              <Plus aria-hidden />
              Add
            </AppButton>
          }
          description="Persist data at container paths."
          icon={<HardDrive aria-hidden className="size-4" />}
          title="Storage"
        >
          {storageRows.length === 0 ? null : (
            <div className="flex min-w-0 flex-col gap-2">
              {storageRows.map((row, index) => {
                const rowError = rowErrorForIndex(validation, "storage", index);
                const sizeError = rowError?.type === "invalid-storage-size";
                return (
                  <div
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_8rem_2.25rem] gap-2.5"
                    key={row.id}
                  >
                    <AppInput
                      aria-invalid={rowError && !sizeError ? true : undefined}
                      aria-label={`Storage ${index + 1} path`}
                      disabled={busy}
                      onChange={(event) => {
                        const path = event.currentTarget.value;
                        setStorageRows((rows) =>
                          rows.map((current, rowIndex) =>
                            rowIndex === index ? { ...current, path } : current
                          )
                        );
                      }}
                      placeholder="/data"
                      value={row.path}
                    />
                    <StorageSizeInput
                      aria-invalid={sizeError ? true : undefined}
                      aria-label={`Storage ${index + 1} size`}
                      disabled={busy}
                      onChange={(size) => {
                        setStorageRows((rows) =>
                          rows.map((current, rowIndex) =>
                            rowIndex === index ? { ...current, size } : current
                          )
                        );
                      }}
                      value={row.size}
                    />
                    <AppIconButton
                      aria-label="Remove storage mount"
                      disabled={busy}
                      onClick={() =>
                        setStorageRows((rows) =>
                          rows.filter((_, rowIndex) => rowIndex !== index)
                        )
                      }
                      size="lg"
                      type="button"
                      variant="danger"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </AppIconButton>
                    {rowError ? (
                      <p className="col-span-3 text-destructive text-xs leading-4">
                        {rowError.message}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </DeploymentSettings.Section>

        <DeploymentSettings.Section
          description="Request public routing to the port where the app listens."
          icon={<Network aria-hidden className="size-4" />}
          title="Network"
        >
          <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DeploymentSettings.Field label="App Listening Port">
              <AppInput
                aria-describedby={
                  portError ? "docker-deployer-port-error" : undefined
                }
                aria-invalid={portError ? true : undefined}
                disabled={busy}
                id="docker-deployer-port"
                inputMode="numeric"
                max={65_535}
                min={1}
                onChange={(event) =>
                  setAppListeningPort(event.currentTarget.value)
                }
                type="number"
                value={appListeningPort}
              />
              {portError ? (
                <p
                  className="text-destructive text-xs leading-4"
                  id="docker-deployer-port-error"
                  role="alert"
                >
                  {portError.message}
                </p>
              ) : null}
            </DeploymentSettings.Field>
            <DeploymentSettings.Field label="Public Address">
              <AppInput
                aria-label="Public Address"
                disabled
                readOnly
                value="Auto-generated Public Address"
              />
            </DeploymentSettings.Field>
          </div>
        </DeploymentSettings.Section>

        {childrenBeforeDeploy}
      </div>

      <AppButton
        aria-busy={busy}
        aria-label="Deploy Docker image"
        className="w-full"
        disabled={!canDeploy}
        onClick={async () => {
          if (!canDeploy) {
            return;
          }
          await onDeploy?.(normalizeDockerDeploymentSettings(settings));
        }}
        type="button"
      >
        {busy ? (
          <Spinner aria-hidden className="size-4 shrink-0" />
        ) : (
          <Rocket aria-hidden className="size-4 shrink-0" />
        )}
        {busy ? "Deploying" : deployLabel}
      </AppButton>
    </div>
  );
}
