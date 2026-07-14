"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import {
  AppSelect,
  type AppSelectOption,
} from "@workspace/ui/components/app-select";
import { DatabaseEngineIcon } from "@workspace/ui/components/database-engine-icon";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { Database, Rocket, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DeploymentSettings } from "./deployment-settings";

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
const INSTANCE_PRESET_SELECT_OPTIONS: readonly AppSelectOption[] =
  INSTANCE_PRESETS.map((preset) => ({
    label: preset.label,
    value: preset.id,
  }));
const REPLICA_SELECT_OPTIONS: readonly AppSelectOption[] = REPLICA_OPTIONS.map(
  (replica) => ({
    label: databaseReplicaOptionLabel(replica),
    value: String(replica),
  })
);

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
  return (
    <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden">
      <DatabaseEngineIcon
        className="size-4 object-contain text-blue-500"
        engine={choice.engine}
        iconUrl={choice.iconUrl}
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
  initialSettings,
  onDeploy,
}: {
  busy?: boolean;
  className?: string;
  databaseOptions: readonly DatabaseDeploymentChoice[];
  deployLabel?: string;
  emptyMessage?: string;
  /** Prefill for edited redeploys (US10): predecessor source values. */
  initialSettings?: Partial<DatabaseDeploymentSettings>;
  onDeploy?: (
    settings: DatabaseDeploymentSettings,
    choice: DatabaseDeploymentChoice
  ) => void | Promise<void>;
}) {
  const initialDatabaseId = useMemo(
    () => defaultDatabaseId(databaseOptions),
    [databaseOptions]
  );
  const [databaseId, setDatabaseId] = useState(
    initialSettings?.databaseId?.trim() || initialDatabaseId
  );
  const [instancePreset, setInstancePreset] = useState<DatabaseInstancePreset>(
    () =>
      INSTANCE_PRESETS.some(
        (preset) => preset.id === initialSettings?.instancePreset
      ) && initialSettings?.instancePreset != null
        ? initialSettings.instancePreset
        : "xs"
  );
  const [replicas, setReplicas] = useState(() => {
    const initial = initialSettings?.replicas;
    return Number.isInteger(initial) &&
      initial != null &&
      initial >= 1 &&
      initial <= 10
      ? String(initial)
      : "1";
  });

  useEffect(() => {
    setDatabaseId((current) =>
      databaseOptions.some((option) => option.id === current)
        ? current
        : defaultDatabaseId(databaseOptions)
    );
  }, [databaseOptions]);

  const choice = selectedChoice(databaseOptions, databaseId);
  const effectiveDatabaseId = choice?.id ?? "";
  const databaseSelectOptions = useMemo(
    (): AppSelectOption[] =>
      databaseOptions.map((option) => ({
        icon: <DatabaseChoiceIcon choice={option} />,
        label: option.label,
        value: option.id,
      })),
    [databaseOptions]
  );
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
      className={cn("dark flex min-w-0 flex-col gap-3.5", className)}
      data-slot="database-deployer"
    >
      <div className="flex min-w-0 flex-col gap-3.5">
        <DeploymentSettings.Section
          description="Choose a managed database engine for this workspace."
          icon={<Database aria-hidden className="size-4" />}
          title="Type"
        >
          <DeploymentSettings.Control>
            <AppSelect
              aria-label="Database engine"
              disabled={busy}
              emptyMessage={emptyMessage}
              onValueChange={setDatabaseId}
              options={databaseSelectOptions}
              placeholder="Choose a database"
              value={effectiveDatabaseId}
            />
          </DeploymentSettings.Control>
        </DeploymentSettings.Section>

        <DeploymentSettings.Section
          description={`${choiceLabel(choice)} instance preset and replica count.`}
          icon={<Upload aria-hidden className="size-4" />}
          title="Instance"
        >
          <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DeploymentSettings.Field
              htmlFor="database-deployer-instance-preset"
              label="Instance Preset"
            >
              <AppSelect
                disabled={busy || choice === null}
                id="database-deployer-instance-preset"
                onValueChange={(value) =>
                  setInstancePreset(value as DatabaseInstancePreset)
                }
                options={INSTANCE_PRESET_SELECT_OPTIONS}
                value={instancePreset}
              />
              <p className="min-h-4 text-muted-foreground text-xs leading-4">
                {choice == null
                  ? "Select a database engine first."
                  : presetSummary(choice.engine, instancePreset)}
              </p>
            </DeploymentSettings.Field>
            <DeploymentSettings.Field
              htmlFor="database-deployer-replicas"
              label="Replicas"
            >
              <AppSelect
                disabled={busy || choice === null}
                id="database-deployer-replicas"
                onValueChange={setReplicas}
                options={REPLICA_SELECT_OPTIONS}
                value={replicas}
              />
            </DeploymentSettings.Field>
          </div>
        </DeploymentSettings.Section>
      </div>

      <AppButton
        aria-busy={busy}
        aria-label="Deploy database"
        className="w-full"
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
