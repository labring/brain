"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
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
  Globe2,
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

function DeploymentCard({
  children,
  description,
  icon,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-resource-pane-border bg-resource-pane-card/40 p-4">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center text-resource-pane-foreground">
            {icon}
          </span>
          <h3 className="truncate font-medium text-resource-pane-foreground text-sm leading-5">
            {title}
          </h3>
        </div>
        <p className="text-resource-pane-muted text-sm leading-5">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
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
      className={cn("flex min-w-0 flex-col gap-3", className)}
      data-slot="docker-deployer"
    >
      <DeploymentCard
        description="Choose the container image to run."
        icon={<Package aria-hidden className="size-4" />}
        title="Image"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="docker-deployer-image">Docker image</Label>
          <Input
            aria-describedby={
              visibleImageError ? "docker-deployer-image-error" : undefined
            }
            aria-invalid={visibleImageError ? true : undefined}
            autoComplete="off"
            className="border-resource-pane-input bg-transparent text-resource-pane-foreground placeholder:text-resource-pane-muted focus-visible:border-theme-blue focus-visible:ring-[1px] focus-visible:ring-theme-blue/50 dark:bg-transparent"
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
            >
              {visibleImageError.message}
            </p>
          ) : null}
        </div>
      </DeploymentCard>

      <DeploymentCard
        description="Set direct environment variables for startup."
        icon={<Settings2 aria-hidden className="size-4" />}
        title="Runtime"
      >
        <div
          className="flex min-w-0 flex-col gap-2"
          data-slot="docker-env-rows"
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="font-medium text-resource-pane-foreground text-sm leading-5">
              Environment Variables
            </p>
            <Button
              aria-label="Add environment variable"
              className="size-8 rounded-lg"
              disabled={busy}
              onClick={() =>
                setEnvRows((rows) => [
                  ...rows,
                  { id: createEnvRowId(), name: nextEnvName(rows), value: "" },
                ])
              }
              size="icon"
              type="button"
              variant="ghost"
            >
              <Plus aria-hidden className="size-4" />
            </Button>
          </div>
          {envRows.length === 0 ? (
            <div className="flex h-10 items-center rounded-md border border-resource-pane-input px-3 text-resource-pane-muted text-sm leading-5">
              No environment variables.
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-2">
              {envRows.map((row, index) => {
                const rowError = envErrorForIndex(validation, index);
                return (
                  <div
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2"
                    key={row.id}
                  >
                    <Input
                      aria-invalid={rowError ? true : undefined}
                      aria-label={`Environment variable ${index + 1} name`}
                      className="border-resource-pane-input bg-transparent text-resource-pane-foreground placeholder:text-resource-pane-muted focus-visible:border-theme-blue focus-visible:ring-[1px] focus-visible:ring-theme-blue/50 dark:bg-transparent"
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
                    <Input
                      aria-label={`Environment variable ${index + 1} value`}
                      className="border-resource-pane-input bg-transparent text-resource-pane-foreground placeholder:text-resource-pane-muted focus-visible:border-theme-blue focus-visible:ring-[1px] focus-visible:ring-theme-blue/50 dark:bg-transparent"
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
                    <Button
                      aria-label="Remove environment variable"
                      className="size-8 rounded-lg"
                      disabled={busy}
                      onClick={() =>
                        setEnvRows((rows) =>
                          rows.filter((_, rowIndex) => rowIndex !== index)
                        )
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
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
      </DeploymentCard>

      <DeploymentCard
        description="Request public routing to the port where the app listens."
        icon={<Network aria-hidden className="size-4" />}
        title="Network"
      >
        <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="docker-deployer-port">App Listening Port</Label>
            <Input
              aria-describedby={
                portError ? "docker-deployer-port-error" : undefined
              }
              aria-invalid={portError ? true : undefined}
              className="border-resource-pane-input bg-transparent text-resource-pane-foreground placeholder:text-resource-pane-muted focus-visible:border-theme-blue focus-visible:ring-[1px] focus-visible:ring-theme-blue/50 dark:bg-transparent"
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
              >
                {portError.message}
              </p>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label>Public Address</Label>
            <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-resource-pane-input px-3 text-resource-pane-foreground text-sm leading-5">
              <Globe2
                aria-hidden
                className="size-4 shrink-0 text-resource-pane-muted"
              />
              <span className="min-w-0 truncate">
                Auto-generated Public Address
              </span>
            </div>
          </div>
        </div>
      </DeploymentCard>

      {childrenBeforeDeploy}

      <Button
        aria-busy={busy}
        aria-label="Deploy Docker image"
        className="h-9 w-full rounded-lg bg-resource-pane-card text-resource-pane-primary hover:bg-resource-pane-input"
        disabled={!canDeploy}
        onClick={async () => {
          if (!canDeploy) {
            return;
          }
          await onDeploy?.(normalizeDockerDeploymentSettings(settings));
        }}
        type="button"
        variant="ghost"
      >
        {busy ? (
          <Spinner aria-hidden className="size-4 shrink-0" />
        ) : (
          <Rocket aria-hidden className="size-4 shrink-0" />
        )}
        {busy ? "Deploying" : deployLabel}
      </Button>
    </div>
  );
}
