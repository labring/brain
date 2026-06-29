"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppInput } from "@workspace/ui/components/app-input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { Blocks, ChevronDown, Rocket, Upload } from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const [open, setOpen] = useState(false);
  const [triggerWidth, setTriggerWidth] = useState<number | undefined>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = selectedChoice(choices, value);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setTriggerWidth(triggerRef.current?.offsetWidth);
    }
  }, []);

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger
        aria-expanded={open}
        aria-label="Template"
        className={cn(
          "flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-input/20 px-3 text-left text-foreground text-sm shadow-none outline-hidden transition-colors",
          "focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/60",
          "data-[popup-open]:border-blue-400 data-[popup-open]:ring-[1px] data-[popup-open]:ring-blue-400/60",
          disabled && "pointer-events-none opacity-50"
        )}
        data-testid="template.deployer.template-combobox"
        disabled={disabled}
        ref={triggerRef}
        role="combobox"
      >
        <span className="flex min-w-0 items-center gap-2">
          <TemplateIcon choice={selected} />
          <span className="min-w-0 truncate">{templateLabel(selected)}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="gap-0 rounded-md border border-blue-400/80 bg-popover/95 p-0 shadow-none ring-0 backdrop-blur-xl"
        style={{ width: triggerWidth }}
      >
        <Command className="rounded-md bg-transparent p-0">
          <CommandInput
            aria-label="Search templates"
            data-testid="template.deployer.search-input"
            placeholder="Search"
          />
          <CommandList className="max-h-80 p-1">
            <CommandEmpty>No templates found.</CommandEmpty>
            <CommandGroup className="p-0">
              {choices.map((choice) => {
                const selected = choice.name === value;
                return (
                  <CommandItem
                    className={cn(
                      "h-10 rounded-md px-2 text-sm data-selected:bg-input/60",
                      selected && "bg-blue-500/20 text-foreground"
                    )}
                    data-checked={selected}
                    data-template-name={choice.name}
                    data-testid="template.deployer.template-option"
                    key={choice.name}
                    onSelect={() => {
                      onValueChange(choice.name);
                      setOpen(false);
                    }}
                    value={`${choice.title || choice.name} ${choice.name}`}
                  >
                    <TemplateIcon choice={choice} />
                    <span className="min-w-0 truncate">
                      {templateLabel(choice)}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
