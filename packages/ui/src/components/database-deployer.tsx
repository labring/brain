"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { DeploymentSettings } from "@workspace/ui/components/deployment-settings/deployment-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { Database, Rocket, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type DatabaseInstancePreset = "xs" | "s" | "m" | "l";

export interface DatabaseDeploymentChoice {
  engine: string;
  iconUrl?: string;
  id: string;
  label: string;
  template?: string;
}

export interface DatabaseDeploymentSettings {
  databaseId: string;
  instancePreset: DatabaseInstancePreset;
  replicas: number;
}

const INSTANCE_PRESETS: readonly {
  id: DatabaseInstancePreset;
  label: string;
}[] = [
  { id: "xs", label: "Small" },
  { id: "s", label: "Medium" },
  { id: "m", label: "Large" },
  { id: "l", label: "XL" },
];

const REPLICA_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);

const PRESET_SUMMARIES: Record<
  string,
  Record<DatabaseInstancePreset, string>
> = {
  mongodb: {
    xs: "Up to 1 CPU · 1 Gi · 3 Gi storage",
    s: "Up to 1 CPU · 2 Gi · 20 Gi storage",
    m: "Up to 2 CPU · 4 Gi · 50 Gi storage",
    l: "Up to 4 CPU · 8 Gi · 100 Gi storage",
  },
  mysql: {
    xs: "Up to 0.5 CPU · 512 Mi · 3 Gi storage",
    s: "Up to 1 CPU · 1 Gi · 10 Gi storage",
    m: "Up to 2 CPU · 2 Gi · 20 Gi storage",
    l: "Up to 4 CPU · 4 Gi · 50 Gi storage",
  },
  postgresql: {
    xs: "Up to 0.5 CPU · 1 Gi · 3 Gi storage",
    s: "Up to 1 CPU · 2 Gi · 10 Gi storage",
    m: "Up to 2 CPU · 4 Gi · 20 Gi storage",
    l: "Up to 4 CPU · 8 Gi · 50 Gi storage",
  },
  redis: {
    xs: "Up to 0.5 CPU · 768 Mi · 3 Gi storage",
    s: "Up to 1 CPU · 1.5 Gi · 4 Gi storage",
    m: "Up to 2 CPU · 3 Gi · 10 Gi storage",
    l: "Up to 4 CPU · 6 Gi · 20 Gi storage",
  },
};

function normalizedEngine(engine: string): string {
  return engine.trim().toLowerCase();
}

function defaultDatabaseId(options: readonly DatabaseDeploymentChoice[]) {
  return (
    options.find((option) => normalizedEngine(option.engine) === "mysql")?.id ??
    options[0]?.id ??
    ""
  );
}

function selectedChoice(
  options: readonly DatabaseDeploymentChoice[],
  selectedId: string
) {
  return (
    options.find((option) => option.id === selectedId) ??
    options.find((option) => option.id === defaultDatabaseId(options)) ??
    null
  );
}

function presetSummary(engine: string, preset: DatabaseInstancePreset): string {
  return (
    PRESET_SUMMARIES[normalizedEngine(engine)]?.[preset] ??
    "Resource preset for this database engine"
  );
}

function choiceLabel(choice: DatabaseDeploymentChoice | null): string {
  return choice?.label.trim() || "Database";
}

export function databaseReplicaOptionLabel(replica: number): string {
  return String(replica);
}

function DatabaseChoiceIcon({ choice }: { choice: DatabaseDeploymentChoice }) {
  const iconUrl = choice.iconUrl?.trim();
  if (!iconUrl) {
    return <Database aria-hidden className="size-4 text-blue-500" />;
  }
  return (
    <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden">
      <img
        alt=""
        className="size-4 object-contain"
        decoding="async"
        height={16}
        loading="lazy"
        src={iconUrl}
        width={16}
      />
    </span>
  );
}

export function DatabaseDeployer({
  busy = false,
  className,
  databaseOptions,
  deployLabel = "Deploy",
  emptyMessage = "No database engines are available.",
  onDeploy,
}: {
  busy?: boolean;
  className?: string;
  databaseOptions: readonly DatabaseDeploymentChoice[];
  deployLabel?: string;
  emptyMessage?: string;
  onDeploy?: (
    settings: DatabaseDeploymentSettings,
    choice: DatabaseDeploymentChoice
  ) => void | Promise<void>;
}) {
  const initialDatabaseId = useMemo(
    () => defaultDatabaseId(databaseOptions),
    [databaseOptions]
  );
  const [databaseId, setDatabaseId] = useState(initialDatabaseId);
  const [instancePreset, setInstancePreset] =
    useState<DatabaseInstancePreset>("xs");
  const [replicas, setReplicas] = useState("1");

  useEffect(() => {
    setDatabaseId((current) =>
      databaseOptions.some((option) => option.id === current)
        ? current
        : defaultDatabaseId(databaseOptions)
    );
  }, [databaseOptions]);

  const choice = selectedChoice(databaseOptions, databaseId);
  const effectiveDatabaseId = choice?.id ?? "";
  const replicaCount = Number(replicas);
  const canDeploy =
    !busy &&
    choice !== null &&
    Number.isInteger(replicaCount) &&
    replicaCount >= 1 &&
    replicaCount <= 10 &&
    onDeploy != null;

  return (
    <div
      className={cn("dark flex min-w-0 flex-col gap-4", className)}
      data-slot="database-deployer"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <DeploymentSettings.Section
          description="Choose a managed database engine for this workspace."
          icon={<Database aria-hidden className="size-4" />}
          title="Type"
        >
          <DeploymentSettings.Control>
            {databaseOptions.length === 0 ? (
              <div className="flex h-10 items-center rounded-md border border-input px-3 text-muted-foreground text-sm leading-5">
                {emptyMessage}
              </div>
            ) : (
              <Select
                disabled={busy}
                onValueChange={setDatabaseId}
                value={effectiveDatabaseId}
              >
                <SelectTrigger
                  aria-label="Database engine"
                  className="h-9 border-input bg-transparent text-foreground"
                >
                  <SelectValue placeholder="Choose a database" />
                </SelectTrigger>
                <SelectContent>
                  {databaseOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <span className="flex min-w-0 items-center gap-2">
                        <DatabaseChoiceIcon choice={option} />
                        <span className="min-w-0 truncate">{option.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </DeploymentSettings.Control>
        </DeploymentSettings.Section>

        <DeploymentSettings.Section
          description={`${choiceLabel(choice)} instance preset and replica count.`}
          icon={<Upload aria-hidden className="size-4" />}
          title="Instance"
        >
          <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DeploymentSettings.Field label="Instance Preset">
              <Select
                disabled={busy || choice === null}
                onValueChange={(value) =>
                  setInstancePreset(value as DatabaseInstancePreset)
                }
                value={instancePreset}
              >
                <SelectTrigger
                  aria-label="Database instance preset"
                  className="h-9 border-input bg-transparent text-foreground"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INSTANCE_PRESETS.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="min-h-4 text-muted-foreground text-xs leading-4">
                {choice == null
                  ? "Select a database engine first."
                  : presetSummary(choice.engine, instancePreset)}
              </p>
            </DeploymentSettings.Field>
            <DeploymentSettings.Field label="Replicas">
              <Select
                disabled={busy || choice === null}
                onValueChange={setReplicas}
                value={replicas}
              >
                <SelectTrigger
                  aria-label="Database replica count"
                  className="h-9 border-input bg-transparent text-foreground"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPLICA_OPTIONS.map((replica) => (
                    <SelectItem key={replica} value={String(replica)}>
                      {databaseReplicaOptionLabel(replica)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DeploymentSettings.Field>
          </div>
        </DeploymentSettings.Section>
      </div>

      <AppButton
        aria-busy={busy}
        aria-label="Deploy database"
        className="h-9 w-full rounded-lg bg-white/5 text-primary hover:bg-input"
        disabled={!canDeploy}
        onClick={async () => {
          if (!(choice && canDeploy)) {
            return;
          }
          await onDeploy?.(
            {
              databaseId: choice.id,
              instancePreset,
              replicas: replicaCount,
            },
            choice
          );
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
