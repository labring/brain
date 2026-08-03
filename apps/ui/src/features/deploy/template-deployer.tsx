"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppInput } from "@workspace/ui/components/app-input";
import {
  AppSelect,
  type AppSelectOption,
} from "@workspace/ui/components/app-select";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { Blocks, Rocket, Upload } from "lucide-react";
import Image from "next/image";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { isSensitiveDeploymentInput } from "@/features/deploy/task/sensitive-inputs";
import { DeploymentSettings } from "./deployment-settings";

export interface TemplateDeploymentInput {
  default?: string;
  description: string;
  key: string;
  options?: string[];
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

interface TemplateInitialArgsSeed {
  args: Record<string, string>;
  templateName: string;
}

interface TemplateDeployerFormState {
  args: Record<string, string>;
  initialSettingsReady: boolean;
  pendingInitialArgs: TemplateInitialArgsSeed | null;
  previousChoices: readonly TemplateDeploymentChoice[];
  previousInitialSettings: TemplateDeploymentInitialSettings | undefined;
  templateName: string;
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

function normalizedInputType(input: TemplateDeploymentInput) {
  return input.type.trim().toLowerCase();
}

function normalizedInputValue(
  input: TemplateDeploymentInput,
  value: string | undefined,
  fallback?: string
) {
  const resolvedValue = value ?? "";
  if (normalizedInputType(input) === "boolean") {
    const normalizedValue = resolvedValue.trim().toLowerCase();
    if (normalizedValue === "true" || normalizedValue === "false") {
      return normalizedValue;
    }
    return fallback === "true" ? "true" : "false";
  }
  if (isSensitiveDeploymentInput(input)) {
    return resolvedValue;
  }
  const options = input.options ?? [];
  if (options.length > 0) {
    if (options.includes(resolvedValue)) {
      return resolvedValue;
    }
    const fallbackValue = fallback ?? "";
    return options.includes(fallbackValue) ? fallbackValue : (options[0] ?? "");
  }
  return resolvedValue;
}

function argsForChoice(
  choice: TemplateDeploymentChoice | null,
  overrides?: Record<string, string>
) {
  const declared = Object.fromEntries(
    (choice?.args ?? []).map((arg) => [
      arg.key,
      normalizedInputValue(arg, arg.default),
    ])
  );
  if (overrides == null) {
    return declared;
  }
  const merged = { ...declared, ...overrides };
  for (const arg of choice?.args ?? []) {
    merged[arg.key] = normalizedInputValue(
      arg,
      merged[arg.key],
      declared[arg.key]
    );
  }
  return merged;
}

function defaultArgs(choice: TemplateDeploymentChoice | null) {
  return argsForChoice(choice);
}

function templateInitialArgsSeed(
  initialSettings: TemplateDeploymentInitialSettings | undefined
): TemplateInitialArgsSeed | null {
  const templateName = initialSettings?.templateName?.trim() ?? "";
  return templateName !== "" && initialSettings?.args != null
    ? { args: initialSettings.args, templateName }
    : null;
}

function templateInitialSelection(
  choices: readonly TemplateDeploymentChoice[],
  initialSettings: TemplateDeploymentInitialSettings | undefined
) {
  const seed = templateInitialArgsSeed(initialSettings);
  const requestedName = initialSettings?.templateName?.trim() ?? "";
  const templateName = requestedName || defaultTemplateName(choices);
  const choice = selectedChoice(choices, templateName);
  let args: Record<string, string> | null = null;
  if (choice != null) {
    args =
      seed?.templateName === choice.name
        ? argsForChoice(choice, seed.args)
        : defaultArgs(choice);
  }
  return { args, choice, seed, templateName };
}

function initialTemplateDeployerFormState(
  choices: readonly TemplateDeploymentChoice[],
  initialSettings: TemplateDeploymentInitialSettings | undefined
): TemplateDeployerFormState {
  const selection = templateInitialSelection(choices, initialSettings);
  return {
    args: selection.args ?? {},
    initialSettingsReady: selection.choice != null,
    pendingInitialArgs: selection.choice == null ? selection.seed : null,
    previousChoices: choices,
    previousInitialSettings: initialSettings,
    templateName: selection.templateName,
  };
}

function formStateForChoices(
  current: TemplateDeployerFormState,
  choices: readonly TemplateDeploymentChoice[]
): TemplateDeployerFormState {
  const templateName =
    current.templateName.trim() || defaultTemplateName(choices);
  const choice = selectedChoice(choices, templateName);
  const seed = current.pendingInitialArgs;
  if (choice == null) {
    return {
      ...current,
      args: seed == null ? {} : current.args,
      initialSettingsReady: false,
      previousChoices: choices,
      templateName,
    };
  }
  const seededArgs =
    seed?.templateName === choice.name
      ? argsForChoice(choice, seed.args)
      : null;
  return {
    ...current,
    args: seededArgs ?? argsForChoice(choice, current.args),
    initialSettingsReady: true,
    pendingInitialArgs: seededArgs == null ? seed : null,
    previousChoices: choices,
    templateName,
  };
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

function TemplateParameterDescription({
  description,
  id,
}: {
  description: string;
  id: string;
}) {
  return description ? (
    <span className="text-muted-foreground text-xs leading-4" id={id}>
      {description}
    </span>
  ) : null;
}

function TemplateParameterControl({
  arg,
  disabled,
  id,
  onValueChange,
  value,
}: {
  arg: TemplateDeploymentInput;
  disabled: boolean;
  id: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const descriptionId = `${id}-description`;
  const describedBy = arg.description ? descriptionId : undefined;
  if (normalizedInputType(arg) === "boolean") {
    return (
      <>
        <div className="flex h-9 items-center gap-2">
          <Checkbox
            aria-describedby={describedBy}
            aria-label={arg.key}
            checked={value === "true"}
            data-template-arg={arg.key}
            data-testid="template.deployer.parameter-input"
            disabled={disabled}
            id={id}
            onCheckedChange={(checked) =>
              onValueChange(checked === true ? "true" : "false")
            }
          />
          <span className="text-muted-foreground text-xs">
            {value === "true" ? "true" : "false"}
          </span>
        </div>
        <TemplateParameterDescription
          description={arg.description}
          id={descriptionId}
        />
      </>
    );
  }
  if (isSensitiveDeploymentInput(arg)) {
    return (
      <AppInput
        aria-label={arg.key}
        data-template-arg={arg.key}
        data-testid="template.deployer.parameter-input"
        disabled={disabled}
        id={id}
        onValueChange={onValueChange}
        placeholder={arg.description || arg.type}
        required={arg.required}
        type="password"
        value={value}
      />
    );
  }
  if ((arg.options?.length ?? 0) > 0) {
    return (
      <>
        <AppSelect
          aria-describedby={describedBy}
          aria-label={arg.key}
          data-testid="template.deployer.parameter-input"
          disabled={disabled}
          id={id}
          key={`${arg.key}:${value}`}
          onValueChange={onValueChange}
          options={(arg.options ?? []).map((option) => ({
            label: option,
            value: option,
          }))}
          placeholder="Select value"
          value={value}
        />
        <TemplateParameterDescription
          description={arg.description}
          id={descriptionId}
        />
      </>
    );
  }
  return (
    <AppInput
      aria-label={arg.key}
      data-template-arg={arg.key}
      data-testid="template.deployer.parameter-input"
      disabled={disabled}
      id={id}
      onValueChange={onValueChange}
      placeholder={arg.description || arg.type}
      required={arg.required}
      value={value}
    />
  );
}

interface TemplateDeployerContextValue {
  args: Record<string, string>;
  busy: boolean;
  canDeploy: boolean;
  catalogError: string;
  choice: TemplateDeploymentChoice | null;
  choices: readonly TemplateDeploymentChoice[];
  loading: boolean;
  requestDeploy: () => void;
  selectTemplate: (templateName: string) => void;
  setArgValue: (key: string, value: string) => void;
  templateName: string;
}

const TemplateDeployerContext =
  createContext<TemplateDeployerContextValue | null>(null);

function useTemplateDeployer(): TemplateDeployerContextValue {
  const value = useContext(TemplateDeployerContext);
  if (!value) {
    throw new Error(
      "TemplateDeployer: parts must be used within TemplateDeployer.Root"
    );
  }
  return value;
}

/** Owns the template selection + argument state; parts read it through context. */
function TemplateDeployerRoot({
  autoDeploy = false,
  busy = false,
  children,
  errorMessage,
  initialSettings,
  loading = false,
  onDeploy,
  onSettingsChange,
  templateOptions: choices,
}: {
  autoDeploy?: boolean;
  busy?: boolean;
  children?: ReactNode;
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
  const [formState, setFormState] = useState(() =>
    initialTemplateDeployerFormState(choices, initialSettings)
  );
  const { args, initialSettingsReady, templateName } = formState;
  const choice = selectedChoice(choices, templateName);
  const autoDeployStateRef = useRef<
    "cancelled" | "eligible" | "pending" | "triggered"
  >("pending");

  if (formState.previousInitialSettings !== initialSettings) {
    setFormState(initialTemplateDeployerFormState(choices, initialSettings));
  } else if (formState.previousChoices !== choices) {
    setFormState(formStateForChoices(formState, choices));
  }

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

  const requestDeploy = useCallback(() => {
    if (choice == null || !canDeploy) {
      return;
    }
    onDeploy?.(settings, choice);
  }, [canDeploy, choice, onDeploy, settings]);

  const selectTemplate = useCallback(
    (nextTemplateName: string) => {
      const nextChoice = selectedChoice(choices, nextTemplateName);
      setFormState((current) => ({
        ...current,
        args: defaultArgs(nextChoice),
        initialSettingsReady: nextChoice != null,
        pendingInitialArgs: null,
        templateName: nextTemplateName,
      }));
    },
    [choices]
  );

  const setArgValue = useCallback((key: string, nextValue: string) => {
    setFormState((current) => ({
      ...current,
      args: {
        ...current.args,
        [key]: nextValue,
      },
    }));
  }, []);

  const value = useMemo<TemplateDeployerContextValue>(
    () => ({
      args,
      busy,
      canDeploy,
      catalogError,
      choice,
      choices,
      loading,
      requestDeploy,
      selectTemplate,
      setArgValue,
      templateName,
    }),
    [
      args,
      busy,
      canDeploy,
      catalogError,
      choice,
      choices,
      loading,
      requestDeploy,
      selectTemplate,
      setArgValue,
      templateName,
    ]
  );

  return (
    <TemplateDeployerContext.Provider value={value}>
      {children}
    </TemplateDeployerContext.Provider>
  );
}

/** Template choice + parameter sections; renders the catalog status when empty. */
function TemplateDeployerFields({
  className,
  emptyMessage = "No templates are available.",
}: {
  className?: string;
  emptyMessage?: string;
}) {
  const inputIdPrefix = useId();
  const {
    args,
    busy,
    catalogError,
    choice,
    choices,
    loading,
    selectTemplate,
    setArgValue,
    templateName,
  } = useTemplateDeployer();

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
      className={cn("flex min-w-0 flex-col gap-3.5", className)}
      data-slot="template-deployer-fields"
    >
      <DeploymentSettings.Section
        icon={<TemplateIcon choice={choice} />}
        title="Template"
      >
        <DeploymentSettings.Control>
          <TemplateSearchSelect
            choices={choices}
            disabled={busy || loading}
            onValueChange={selectTemplate}
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
                  <div
                    className="flex min-w-0 flex-col gap-1.5"
                    data-template-arg={arg.key}
                    key={arg.key}
                  >
                    <label
                      className="font-medium text-muted-foreground text-xs leading-4"
                      htmlFor={inputId}
                    >
                      {arg.key}
                    </label>
                    <TemplateParameterControl
                      arg={arg}
                      disabled={busy || loading}
                      id={inputId}
                      onValueChange={(nextValue) => {
                        setArgValue(arg.key, nextValue);
                      }}
                      value={args[arg.key] ?? ""}
                    />
                  </div>
                );
              })}
            </div>
          </DeploymentSettings.Control>
        </DeploymentSettings.Section>
      ) : null}
    </div>
  );
}

/** Separately placeable Deploy action; hosts decide where it lands. */
function TemplateDeployerSubmit({
  className,
  label = "Deploy",
}: {
  className?: string;
  label?: string;
}) {
  const { busy, canDeploy, requestDeploy } = useTemplateDeployer();
  return (
    <AppButton
      className={className}
      data-testid="template.deployer.submit"
      disabled={!canDeploy}
      onClick={requestDeploy}
      type="button"
    >
      {busy ? (
        <Spinner aria-hidden className="size-4" />
      ) : (
        <Rocket aria-hidden className="size-4" />
      )}
      {label}
    </AppButton>
  );
}

/** Assembled default form: sections with an inline full-width Deploy action. */
function TemplateDeployerForm({
  autoDeploy,
  busy,
  className,
  deployLabel = "Deploy",
  emptyMessage,
  errorMessage,
  initialSettings,
  loading,
  onDeploy,
  onSettingsChange,
  templateOptions,
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
  return (
    <TemplateDeployerRoot
      autoDeploy={autoDeploy}
      busy={busy}
      errorMessage={errorMessage}
      initialSettings={initialSettings}
      loading={loading}
      onDeploy={onDeploy}
      onSettingsChange={onSettingsChange}
      templateOptions={templateOptions}
    >
      {templateOptions.length === 0 ? (
        <TemplateDeployerFields
          className={className}
          emptyMessage={emptyMessage}
        />
      ) : (
        <div
          className={cn("dark flex min-w-0 flex-col gap-3.5", className)}
          data-slot="template-deployer"
          data-testid="template.deployer"
        >
          <TemplateDeployerFields />
          <TemplateDeployerSubmit className="w-full" label={deployLabel} />
        </div>
      )}
    </TemplateDeployerRoot>
  );
}

TemplateDeployerRoot.displayName = "TemplateDeployer.Root";
TemplateDeployerFields.displayName = "TemplateDeployer.Fields";
TemplateDeployerSubmit.displayName = "TemplateDeployer.Submit";

/**
 * Compound template deployment form. The assembled component keeps the inline
 * submit for hosts without pane chrome; pane hosts compose `Root` + `Fields`
 * and place `Submit` in the Side Pane Footer.
 */
export const TemplateDeployer = Object.assign(TemplateDeployerForm, {
  Fields: TemplateDeployerFields,
  Root: TemplateDeployerRoot,
  Submit: TemplateDeployerSubmit,
});
