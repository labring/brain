"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppInput } from "@workspace/ui/components/app-input";
import {
  AppSelect,
  type AppSelectOption,
} from "@workspace/ui/components/app-select";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { Blocks, Rocket, Upload } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useMemo, useState } from "react";
import { DeploymentSettings } from "./deployment-settings";

export interface TemplateDeploymentInput {
  default?: string;
  description: string;
  key: string;
  required: boolean;
  type: string;
}

export interface TemplateDeploymentChoice {
  args: TemplateDeploymentInput[];
  category?: string[];
  description: string;
  icon?: string;
  name: string;
  sourceRepos?: string[];
  title: string;
}

export interface TemplateDeploymentSettings {
  args: Record<string, string>;
  templateName: string;
}

function defaultTemplateName(options: readonly TemplateDeploymentChoice[]) {
  return options[0]?.name ?? "";
}

function selectedChoice(
  options: readonly TemplateDeploymentChoice[],
  selectedName: string
) {
  return (
    options.find((option) => option.name === selectedName) ??
    options.find((option) => option.name === defaultTemplateName(options)) ??
    null
  );
}

function defaultArgs(choice: TemplateDeploymentChoice | null) {
  return Object.fromEntries(
    (choice?.args ?? []).map((arg) => [arg.key, arg.default ?? ""])
  );
}

function templateLabel(choice: TemplateDeploymentChoice | null) {
  return choice?.title || choice?.name || "Select template";
}

function TemplateIcon({
  choice,
  className,
}: {
  choice: TemplateDeploymentChoice | null;
  className?: string;
}) {
  const icon = choice?.icon?.trim();
  if (!icon) {
    return (
      <Blocks aria-hidden className={cn("size-4 text-blue-400", className)} />
    );
  }
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center overflow-hidden",
        className
      )}
    >
      <Image
        alt=""
        className="size-4 object-contain"
        height={16}
        src={icon}
        unoptimized
        width={16}
      />
    </span>
  );
}

function TemplateSearchSelect({
  choices,
  disabled,
  onValueChange,
  value,
}: {
  choices: readonly TemplateDeploymentChoice[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const options = useMemo<AppSelectOption[]>(
    () =>
      choices.map((choice) => ({
        icon: <TemplateIcon choice={choice} />,
        label: templateLabel(choice),
        textValue: `${choice.title || choice.name} ${choice.name}`,
        value: choice.name,
      })),
    [choices]
  );

  return (
    <AppSelect
      aria-label="Template"
      data-testid="template.deployer.template-combobox"
      disabled={disabled}
      onValueChange={onValueChange}
      options={options}
      placeholder="Select template"
      searchable
      searchPlaceholder="Search"
      value={value}
    />
  );
}

export function TemplateDeployer({
  busy = false,
  className,
  deployLabel = "Deploy",
  emptyMessage = "No templates are available.",
  onDeploy,
  onSettingsChange,
  templateOptions: choices,
}: {
  busy?: boolean;
  className?: string;
  deployLabel?: string;
  emptyMessage?: string;
  onDeploy?: (
    settings: TemplateDeploymentSettings,
    choice: TemplateDeploymentChoice
  ) => void | Promise<void>;
  onSettingsChange?: (
    settings: TemplateDeploymentSettings,
    choice: TemplateDeploymentChoice | null
  ) => void;
  templateOptions: readonly TemplateDeploymentChoice[];
}) {
  const inputIdPrefix = useId();
  const [templateName, setTemplateName] = useState(
    defaultTemplateName(choices)
  );
  const choice = selectedChoice(choices, templateName);
  const [args, setArgs] = useState<Record<string, string>>(() =>
    defaultArgs(choice)
  );

  useEffect(() => {
    setTemplateName(
      (current) =>
        selectedChoice(choices, current)?.name ?? defaultTemplateName(choices)
    );
  }, [choices]);

  useEffect(() => {
    setArgs(defaultArgs(choice));
  }, [choice]);

  const settings = useMemo<TemplateDeploymentSettings>(
    () => ({ args, templateName }),
    [args, templateName]
  );
  const missingRequired = (choice?.args ?? []).find(
    (arg) => arg.required && (args[arg.key]?.trim() ?? "") === ""
  );
  const canDeploy = !busy && choice != null && missingRequired == null;

  useEffect(() => {
    onSettingsChange?.(settings, choice);
  }, [choice, onSettingsChange, settings]);

  if (choices.length === 0) {
    return (
      <div
        className={cn(
          "dark flex min-w-0 items-center justify-center rounded-md border border-border/60 p-4 text-muted-foreground text-sm",
          className
        )}
        data-slot="template-deployer-empty"
        data-testid="template.deployer.empty"
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={cn("dark flex min-w-0 flex-col gap-4", className)}
      data-slot="template-deployer"
      data-testid="template.deployer"
    >
      <DeploymentSettings.Section
        icon={<TemplateIcon choice={choice} />}
        title="Template"
      >
        <DeploymentSettings.Control>
          <TemplateSearchSelect
            choices={choices}
            disabled={busy}
            onValueChange={setTemplateName}
            value={templateName}
          />
          <p className="text-muted-foreground text-sm leading-5">
            {choice?.description || "Choose a template to deploy."}
          </p>
        </DeploymentSettings.Control>
      </DeploymentSettings.Section>

      {(choice?.args.length ?? 0) > 0 ? (
        <DeploymentSettings.Section
          description="Provide template parameters before deploying."
          icon={<Upload aria-hidden className="size-4" />}
          title="Parameters"
        >
          <DeploymentSettings.Control>
            <div className="flex min-w-0 flex-col gap-3">
              {choice?.args.map((arg) => {
                const inputId = `${inputIdPrefix}-${arg.key}`;
                return (
                  <label
                    className="flex min-w-0 flex-col gap-1.5"
                    htmlFor={inputId}
                    key={arg.key}
                  >
                    <span className="font-medium text-muted-foreground text-xs leading-4">
                      {arg.key}
                    </span>
                    <AppInput
                      aria-label={arg.key}
                      data-template-arg={arg.key}
                      data-testid="template.deployer.parameter-input"
                      disabled={busy}
                      id={inputId}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        setArgs((current) => ({
                          ...current,
                          [arg.key]: nextValue,
                        }));
                      }}
                      placeholder={arg.description || arg.type}
                      value={args[arg.key] ?? ""}
                    />
                  </label>
                );
              })}
            </div>
          </DeploymentSettings.Control>
        </DeploymentSettings.Section>
      ) : null}

      <AppButton
        className="w-full"
        data-testid="template.deployer.submit"
        disabled={!canDeploy}
        onClick={() => {
          if (choice == null || !canDeploy) {
            return;
          }
          onDeploy?.(settings, choice);
        }}
        type="button"
      >
        {busy ? (
          <Spinner aria-hidden className="size-4" />
        ) : (
          <Rocket aria-hidden className="size-4" />
        )}
        {deployLabel}
      </AppButton>
    </div>
  );
}
