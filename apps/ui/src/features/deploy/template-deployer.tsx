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
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isSensitiveDeploymentInput } from "@/features/deploy/task/sensitive-inputs";
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
  /** Keys the create request declares sensitive — values never at rest. */
  sensitiveKeys: string[];
  templateName: string;
}

/** Prefill for edited redeploys (US10): predecessor source values. */
export interface TemplateDeploymentInitialSettings {
  args?: Record<string, string>;
  templateName?: string;
}

function defaultTemplateName(options: readonly TemplateDeploymentChoice[]) {
  return options[0]?.name ?? "";
}

function selectedChoice(
  options: readonly TemplateDeploymentChoice[],
  selectedName: string
) {
  return options.find((option) => option.name === selectedName) ?? null;
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

/** Sensitive arg keys for a template choice (shared predicate, ADR 0037). */
export function templateSensitiveKeys(
  choice: Pick<TemplateDeploymentChoice, "args"> | null
): string[] {
  return (choice?.args ?? [])
    .filter((arg) => isSensitiveDeploymentInput(arg))
    .map((arg) => arg.key);
}

export function TemplateDeployer({
  autoDeploy = false,
  busy = false,
  className,
  deployLabel = "Deploy",
  emptyMessage = "No templates are available.",
  errorMessage,
  initialSettings,
  loading = false,
  onDeploy,
  onSettingsChange,
  templateOptions: choices,
}: {
  autoDeploy?: boolean;
  busy?: boolean;
  className?: string;
  deployLabel?: string;
  emptyMessage?: string;
  errorMessage?: string;
  onDeploy?: (
    settings: TemplateDeploymentSettings,
    choice: TemplateDeploymentChoice
  ) => void | Promise<void>;
  onSettingsChange?: (
    settings: TemplateDeploymentSettings,
    choice: TemplateDeploymentChoice | null
  ) => void;
  initialSettings?: TemplateDeploymentInitialSettings;
  loading?: boolean;
  templateOptions: readonly TemplateDeploymentChoice[];
}) {
  const inputIdPrefix = useId();
  const [templateName, setTemplateName] = useState(
    () => initialSettings?.templateName?.trim() || defaultTemplateName(choices)
  );
  const choice = selectedChoice(choices, templateName);
  const [args, setArgs] = useState<Record<string, string>>(() =>
    defaultArgs(choice)
  );
  const [initialSettingsReady, setInitialSettingsReady] = useState(false);
  const autoDeployStateRef = useRef<
    "cancelled" | "eligible" | "pending" | "triggered"
  >("pending");
  // Prefill args apply once, when the initial template's choice first
  // resolves from the catalog; switching templates resets to defaults.
  const initialArgsRef = useRef<{
    args: Record<string, string>;
    templateName: string;
  } | null>(
    initialSettings?.templateName?.trim() && initialSettings.args != null
      ? {
          args: initialSettings.args,
          templateName: initialSettings.templateName.trim(),
        }
      : null
  );
  const appliedInitialSettingsRef = useRef(initialSettings);

  useEffect(() => {
    setTemplateName((current) =>
      current.trim() === "" ? defaultTemplateName(choices) : current
    );
  }, [choices]);

  useEffect(() => {
    if (appliedInitialSettingsRef.current === initialSettings) {
      return;
    }
    setInitialSettingsReady(false);
    appliedInitialSettingsRef.current = initialSettings;
    const nextTemplateName = initialSettings?.templateName?.trim() ?? "";
    initialArgsRef.current =
      nextTemplateName !== "" && initialSettings?.args != null
        ? { args: initialSettings.args, templateName: nextTemplateName }
        : null;
    const nextSelectedName = nextTemplateName || defaultTemplateName(choices);
    const nextChoice = selectedChoice(choices, nextSelectedName);
    const seed = initialArgsRef.current;
    if (nextChoice != null) {
      setArgs(
        seed?.templateName === nextChoice.name
          ? { ...defaultArgs(nextChoice), ...seed.args }
          : defaultArgs(nextChoice)
      );
      if (seed?.templateName === nextChoice.name) {
        initialArgsRef.current = null;
      }
    }
    setTemplateName(nextSelectedName);
  }, [choices, initialSettings]);

  useEffect(() => {
    const seed = initialArgsRef.current;
    if (seed != null && choice != null && choice.name === seed.templateName) {
      initialArgsRef.current = null;
      setArgs({ ...defaultArgs(choice), ...seed.args });
      setInitialSettingsReady(true);
      return;
    }
    setArgs(defaultArgs(choice));
    setInitialSettingsReady(choice != null);
  }, [choice]);

  const settings = useMemo<TemplateDeploymentSettings>(
    () => ({
      args,
      sensitiveKeys: templateSensitiveKeys(choice),
      templateName,
    }),
    [args, choice, templateName]
  );
  const missingRequired = (choice?.args ?? []).find(
    (arg) => arg.required && (args[arg.key]?.trim() ?? "") === ""
  );
  const requiredArgsComplete = missingRequired == null;
  const catalogError = errorMessage?.trim() ?? "";
  const canDeploy =
    !(busy || loading) &&
    catalogError === "" &&
    choice != null &&
    missingRequired == null;

  useEffect(() => {
    onSettingsChange?.(settings, choice);
  }, [choice, onSettingsChange, settings]);

  useEffect(() => {
    if (!(autoDeploy && initialSettingsReady) || choice == null) {
      return;
    }

    if (autoDeployStateRef.current === "pending") {
      const requestedTemplateName = initialSettings?.templateName?.trim();
      autoDeployStateRef.current =
        requestedTemplateName === choice.name && requiredArgsComplete
          ? "eligible"
          : "cancelled";
    }

    if (
      autoDeployStateRef.current !== "eligible" ||
      !canDeploy ||
      onDeploy == null
    ) {
      return;
    }
    autoDeployStateRef.current = "triggered";
    onDeploy(settings, choice);
  }, [
    autoDeploy,
    canDeploy,
    choice,
    initialSettings,
    initialSettingsReady,
    onDeploy,
    requiredArgsComplete,
    settings,
  ]);

  if (choices.length === 0) {
    const statusMessage =
      catalogError || (loading ? "Loading templates..." : emptyMessage);
    return (
      <div
        className={cn(
          "dark flex min-w-0 items-center justify-center rounded-md border border-border/60 p-4 text-muted-foreground text-sm",
          className
        )}
        data-slot="template-deployer-empty"
        data-testid="template.deployer.empty"
      >
        {statusMessage}
      </div>
    );
  }

  return (
    <div
      className={cn("dark flex min-w-0 flex-col gap-3.5", className)}
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
            disabled={busy || loading}
            onValueChange={(nextTemplateName) => {
              initialArgsRef.current = null;
              setTemplateName(nextTemplateName);
            }}
            value={templateName}
          />
          <p
            className="text-muted-foreground text-sm leading-5"
            data-testid="template.deployer.status"
          >
            {catalogError ||
              choice?.description ||
              (templateName.trim() === ""
                ? "Choose a template to deploy."
                : `Template "${templateName}" is unavailable. Choose another template.`)}
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
                      disabled={busy || loading}
                      id={inputId}
                      onValueChange={(nextValue) => {
                        setArgs((current) => ({
                          ...current,
                          [arg.key]: nextValue,
                        }));
                      }}
                      placeholder={arg.description || arg.type}
                      type={
                        isSensitiveDeploymentInput(arg) ? "password" : undefined
                      }
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
