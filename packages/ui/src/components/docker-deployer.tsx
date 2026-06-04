"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { DeploymentSettings } from "@workspace/ui/components/deployment-settings/deployment-settings";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  DEFAULT_DOCKER_APP_LISTENING_PORT,
  type DockerDeploymentEnvVar,
  type DockerDeploymentSettings,
  normalizeDockerDeploymentSettings,
  validateDockerDeploymentSettings,
} from "@workspace/ui/lib/docker-deployment-settings";
import { cn } from "@workspace/ui/lib/utils";
import {
  Network,
  Package,
  Plus,
  Rocket,
  Settings2,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

export type {
  DockerDeploymentEnvVar,
  DockerDeploymentSettings,
} from "@workspace/ui/lib/docker-deployment-settings";

interface DockerDeploymentEnvRowState extends DockerDeploymentEnvVar {
  id: string;
}

let envRowIdSequence = 0;

function createEnvRowId(): string {
  envRowIdSequence += 1;
  return `docker-env-${envRowIdSequence}`;
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
  const [imageTouched, setImageTouched] = useState(false);
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

  const settings = useMemo<DockerDeploymentSettings>(
    () => ({
      appListeningPort: Number(appListeningPort),
      env: envRows.map((row) => ({ name: row.name, value: row.value })),
      image,
    }),
    [appListeningPort, envRows, image]
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
      className={cn("dark flex min-w-0 flex-col gap-4", className)}
      data-slot="docker-deployer"
    >
      <div className="flex min-w-0 flex-col gap-3">
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
          action={
            <AppIconButton
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
              size="md"
              type="button"
              variant="quiet"
            >
              <Plus aria-hidden className="size-4" />
            </AppIconButton>
          }
          description="Set direct environment variables for startup."
          icon={<Settings2 aria-hidden className="size-4" />}
          title="Runtime"
        >
          <div
            className="flex min-w-0 flex-col gap-2"
            data-slot="docker-env-rows"
          >
            {envRows.length === 0 ? (
              <AppInput
                aria-label="Environment variables"
                disabled
                readOnly
                value="No environment variables."
              />
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                {envRows.map((row, index) => {
                  const rowError = envErrorForIndex(validation, index);
                  return (
                    <div
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2"
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
                        className="hover:text-red-500"
                        disabled={busy}
                        onClick={() =>
                          setEnvRows((rows) =>
                            rows.filter((_, rowIndex) => rowIndex !== index)
                          )
                        }
                        size="lg"
                        type="button"
                        variant="quiet"
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
          </div>
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
        className="h-9 w-full rounded-lg bg-white/5 text-primary hover:bg-input"
        disabled={!canDeploy}
        onClick={async () => {
          if (!canDeploy) {
            return;
          }
          await onDeploy?.(normalizeDockerDeploymentSettings(settings));
        }}
        type="button"
        variant="quiet"
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
