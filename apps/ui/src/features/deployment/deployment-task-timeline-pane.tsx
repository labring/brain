"use client";

import { AppInput } from "@workspace/ui/components/app-input";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { SidePane } from "@workspace/ui/components/side-pane";
import { cn } from "@workspace/ui/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  LoaderCircle,
  PackageCheck,
  Rocket,
  Send,
  XCircle,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import type {
  DeploymentResultResourceCard,
  DeploymentResultResourceCardStatus,
  DeploymentResultResourceRef,
  DeploymentTaskTimelineSnapshot,
  DeploymentTimelineEvent,
  DeploymentTimelineEventSeverity,
  DeploymentTimelineStep,
  DeploymentTimelineStepStatus,
} from "@/lib/deploy-task/timeline";
import type {
  DeploymentTaskDeploymentPlan,
  DeploymentTaskDeploymentPlanInput,
  DeploymentTaskTimelineSnapshotDTO,
  DeployTaskBlockingInput,
} from "@/lib/deploy-task/types";
import { useDeploymentTaskTimeline } from "@/lib/deploy-task/use-deployment-task-timeline";

interface DeploymentTaskTimelinePaneProps {
  kubeconfig: string;
  namespace: string;
  onClose: () => void;
  taskId: string;
}

function statusDotTone(
  status: DeploymentTimelineStepStatus | DeploymentResultResourceCardStatus
): string {
  switch (status) {
    case "completed":
    case "running":
      return "bg-emerald-400 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-emerald-400)_18%,transparent)]";
    case "creating":
    case "pending":
      return "bg-blue-400 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-blue-400)_18%,transparent)]";
    case "blocked":
    case "unknown":
      return "bg-amber-400 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-amber-400)_18%,transparent)]";
    case "failed":
      return "bg-destructive shadow-[0_0_0_3px_color-mix(in_oklab,var(--destructive)_18%,transparent)]";
    case "skipped":
      return "bg-muted-foreground/50";
    default:
      return status satisfies never;
  }
}

function statusMarkerTone(
  status: DeploymentTimelineStepStatus | DeploymentResultResourceCardStatus
): string {
  switch (status) {
    case "completed":
    case "running":
      return "border-emerald-400/35 bg-emerald-500/20 text-emerald-300";
    case "creating":
    case "pending":
      return "border-blue-400/35 bg-blue-500/20 text-blue-300";
    case "blocked":
    case "unknown":
      return "border-amber-400/35 bg-amber-500/20 text-amber-300";
    case "failed":
      return "border-destructive/35 bg-destructive/20 text-destructive";
    case "skipped":
      return "border-white/10 bg-white/5 text-muted-foreground";
    default:
      return status satisfies never;
  }
}

function statusMarkerIcon(
  status: DeploymentTimelineStepStatus | DeploymentResultResourceCardStatus
) {
  switch (status) {
    case "completed":
      return <CheckCircle2 aria-hidden className="size-3" />;
    case "running":
    case "creating":
      return <LoaderCircle aria-hidden className="size-3 animate-spin" />;
    case "pending":
      return <Clock3 aria-hidden className="size-3" />;
    case "blocked":
    case "unknown":
      return <AlertTriangle aria-hidden className="size-3" />;
    case "failed":
      return <XCircle aria-hidden className="size-3" />;
    case "skipped":
      return <Circle aria-hidden className="size-3" />;
    default:
      return status satisfies never;
  }
}

function StatusMarker({
  status,
}: {
  status: DeploymentTimelineStepStatus | DeploymentResultResourceCardStatus;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
        statusMarkerTone(status)
      )}
    >
      {statusMarkerIcon(status)}
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-muted-foreground text-sm">
      {children}
    </div>
  );
}

function TimelineBorderBeam() {
  const gradientId = useId();

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[inherit] border border-white/10"
    >
      <svg
        aria-hidden
        className="absolute inset-0 size-full overflow-visible motion-reduce:hidden"
        preserveAspectRatio="none"
      >
        <title>Animated deployment timeline border</title>
        <defs>
          <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="32%" stopColor="rgba(96, 165, 250, 0.18)" />
            <stop offset="52%" stopColor="#60A5FA" />
            <stop offset="72%" stopColor="rgba(147, 197, 253, 0.7)" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        <rect
          className="[animation:deployment-timeline-border-beam_8s_linear_infinite]"
          fill="none"
          height="100%"
          pathLength="100"
          rx="8"
          ry="8"
          stroke={`url(#${gradientId})`}
          strokeDasharray="18 82"
          strokeLinecap="round"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          width="100%"
          x="0"
          y="0"
        />
        <rect
          className="opacity-70 [animation-delay:-4s] [animation:deployment-timeline-border-beam_8s_linear_infinite]"
          fill="none"
          height="100%"
          pathLength="100"
          rx="8"
          ry="8"
          stroke={`url(#${gradientId})`}
          strokeDasharray="12 88"
          strokeLinecap="round"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          width="100%"
          x="0"
          y="0"
        />
      </svg>
    </span>
  );
}

function eventSeverityTone(
  severity: DeploymentTimelineEventSeverity | undefined
): string {
  switch (severity) {
    case "success":
      return "bg-emerald-400";
    case "warning":
      return "bg-amber-400";
    case "error":
      return "bg-destructive";
    case "info":
    case undefined:
      return "bg-muted-foreground/60";
    default:
      return severity satisfies never;
  }
}

function TimelineEventList({
  events,
  showSeverity = false,
}: {
  events: readonly DeploymentTimelineEvent[];
  showSeverity?: boolean;
}) {
  if (events.length === 0) {
    return null;
  }
  return (
    <ol className="flex flex-col gap-1.5">
      {events.map((event) => (
        <li
          className={cn(
            "grid min-w-0 items-start gap-2 text-xs",
            showSeverity
              ? "grid-cols-[0.5rem_6rem_minmax(0,1fr)]"
              : "grid-cols-[6rem_minmax(0,1fr)]"
          )}
          key={event.id}
        >
          {showSeverity ? (
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-1 rounded-full",
                eventSeverityTone(event.severity)
              )}
            />
          ) : null}
          <span className="truncate font-mono text-[10px] text-muted-foreground leading-4">
            {event.createdAt}
          </span>
          <span className="min-w-0 text-foreground/90 leading-4">
            {event.message}
          </span>
        </li>
      ))}
    </ol>
  );
}

function resultResourceKindLabel(ref: DeploymentResultResourceRef): string {
  switch (ref.kind) {
    case "AP":
      return "AP";
    case "DB":
      return "DB";
    case "PublicAccess":
      return "Public access";
    case "TemplateWorkload":
      return ref.workloadKind || "Workload";
    default:
      return ref satisfies never;
  }
}

function resultResourceMeta(card: DeploymentResultResourceCard): string {
  return [
    resultResourceKindLabel(card.resultRef),
    card.required ? "Required" : "Optional",
    card.latestStatusText,
  ]
    .filter((value): value is string => value != null && value.trim() !== "")
    .join(" ");
}

function defaultResourceCardOpen(
  status: DeploymentResultResourceCardStatus
): boolean {
  return status !== "running";
}

function useResourceCardOpen(status: DeploymentResultResourceCardStatus) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [autoOpen, setAutoOpen] = useState(() =>
    defaultResourceCardOpen(status)
  );

  useEffect(() => {
    if (manualOpen !== null) {
      return;
    }
    if (defaultResourceCardOpen(status)) {
      setAutoOpen(true);
    }
  }, [manualOpen, status]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setManualOpen(nextOpen);
  }, []);

  return {
    onOpenChange: handleOpenChange,
    open: manualOpen ?? autoOpen,
  };
}

function ResultResourceCard({ card }: { card: DeploymentResultResourceCard }) {
  const { onOpenChange, open } = useResourceCardOpen(card.status);
  const latestEvent = card.events.at(-1);
  const meta = resultResourceMeta(card);

  return (
    <Collapsible
      className={cn(
        "overflow-hidden rounded-md border border-white/8 bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors",
        open && "bg-white/[0.06]"
      )}
      data-slot="deployment-result-resource-card"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CollapsibleTrigger
        className="group/resource-card flex w-full cursor-pointer flex-col gap-2 px-3 py-2.5 text-left outline-none transition-colors hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-ring/30"
        type="button"
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                statusDotTone(card.status)
              )}
            />
            <div className="min-w-0">
              <div
                className="truncate font-medium text-foreground text-xs leading-4"
                title={card.title}
              >
                {card.title}
              </div>
              <div className="mt-1 truncate text-[11px] text-muted-foreground leading-4">
                {meta}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="sr-only">{card.status}</span>
            <div
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                statusDotTone(card.status)
              )}
            />
            <ChevronDown
              aria-hidden
              className="size-3 shrink-0 text-muted-foreground transition-transform group-data-panel-open/resource-card:rotate-180"
            />
          </div>
        </div>
        {latestEvent == null ? null : (
          <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-2 pl-3.5 text-xs">
            <span className="truncate font-mono text-[10px] text-muted-foreground leading-4">
              {latestEvent.createdAt}
            </span>
            <span className="min-w-0 truncate text-foreground/90 leading-4">
              {latestEvent.message}
            </span>
          </div>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-white/8 border-t px-3 py-2.5 pl-6 outline-none">
        {card.events.length === 0 ? (
          <p className="text-muted-foreground text-xs leading-4">
            No resource events recorded yet.
          </p>
        ) : (
          <TimelineEventList events={card.events} showSeverity />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function TimelineStepItem({
  children,
  step,
}: {
  children?: ReactNode;
  step: DeploymentTimelineStep;
}) {
  const cards = step.resultCards ?? [];
  return (
    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2.5">
      <div className="flex flex-col items-center pt-1">
        <StatusMarker status={step.status} />
        <span className="mt-1 min-h-6 w-px flex-1 bg-white/12" />
      </div>
      <div className="min-w-0 pb-3.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h3
            className="truncate font-medium text-foreground text-sm leading-5"
            title={step.label}
          >
            {step.label}
          </h3>
          <span className="shrink-0 text-muted-foreground text-xs capitalize leading-4">
            {step.status}
          </span>
        </div>
        <div className="mt-1.5">
          <TimelineEventList events={step.events} />
        </div>
        {cards.length === 0 ? null : (
          <div className="mt-2 flex flex-col gap-2">
            {cards.map((card) => (
              <ResultResourceCard card={card} key={card.id} />
            ))}
          </div>
        )}
        {children == null ? null : <div className="mt-2">{children}</div>}
      </div>
    </section>
  );
}

function inputInitialValue(input: DeploymentTaskDeploymentPlanInput): string {
  return input.default ?? "";
}

function inputKey(input: DeployTaskBlockingInput): string {
  return input.key ?? input.id;
}

function blockingPlanInputs({
  blockingInputs,
  plan,
}: {
  blockingInputs: readonly DeployTaskBlockingInput[];
  plan: DeploymentTaskDeploymentPlan | undefined;
}): DeploymentTaskDeploymentPlanInput[] {
  if (
    blockingInputs.length === 0 &&
    (plan?.missingInputKeys?.length ?? 0) > 0
  ) {
    const missing = new Set(plan?.missingInputKeys ?? []);
    return (plan?.inputs ?? []).filter((input) => missing.has(input.key));
  }
  const planInputs = new Map(
    (plan?.inputs ?? []).map((input) => [input.key, input])
  );
  return blockingInputs.map((input) => {
    const key = inputKey(input);
    const planInput = planInputs.get(key);
    return {
      default: input.defaultValue ?? planInput?.default,
      description: input.description ?? planInput?.description,
      if: planInput?.if,
      key,
      label: input.label || planInput?.label || key,
      options: input.options ?? planInput?.options,
      required: input.required,
      sensitive:
        input.sensitive ?? planInput?.sensitive ?? input.type === "secret",
      type: input.valueType ?? planInput?.type ?? input.type,
    };
  });
}

function deploymentInputControlType(input: DeploymentTaskDeploymentPlanInput) {
  const type = input.type?.trim().toLowerCase();
  if ((input.options?.length ?? 0) > 0 || type === "choice") {
    return "choice";
  }
  if (type === "boolean") {
    return "boolean";
  }
  if (input.sensitive) {
    return "password";
  }
  if (type === "number") {
    return "number";
  }
  return "text";
}

function deploymentInputFormValues({
  fallbackValues,
  formData,
  inputs,
}: {
  fallbackValues: Record<string, string>;
  formData: FormData;
  inputs: readonly DeploymentTaskDeploymentPlanInput[];
}): Record<string, string> {
  return Object.fromEntries(
    inputs.map((input) => {
      const formValue = formData.get(input.key);
      return [
        input.key,
        typeof formValue === "string"
          ? formValue
          : (fallbackValues[input.key] ?? ""),
      ];
    })
  );
}

function missingRequiredDeploymentInputs(
  inputs: readonly DeploymentTaskDeploymentPlanInput[],
  values: Record<string, string>
): DeploymentTaskDeploymentPlanInput[] {
  return inputs.filter(
    (input) => input.required && (values[input.key] ?? "").trim() === ""
  );
}

function DeploymentInputControl({
  controlType,
  input,
  onChange,
  value,
}: {
  controlType: "boolean" | "choice" | "number" | "password" | "text";
  input: DeploymentTaskDeploymentPlanInput;
  onChange: (value: string) => void;
  value: string;
}) {
  const controlId = `deployment-input-${input.key}`;
  if (controlType === "choice") {
    return (
      <>
        <input name={input.key} type="hidden" value={value} />
        <Select onValueChange={onChange} value={value}>
          <SelectTrigger className="h-9" id={controlId}>
            <SelectValue placeholder="Select value" />
          </SelectTrigger>
          <SelectContent>
            {(input.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </>
    );
  }
  if (controlType === "boolean") {
    return (
      <>
        <input name={input.key} type="hidden" value={value} />
        <div className="flex h-9 items-center gap-2">
          <Checkbox
            checked={value === "true"}
            id={controlId}
            onCheckedChange={(checked) =>
              onChange(checked === true ? "true" : "false")
            }
          />
          <span className="text-muted-foreground text-xs">
            {value === "true" ? "Enabled" : "Disabled"}
          </span>
        </div>
      </>
    );
  }
  return (
    <AppInput
      autoComplete={controlType === "password" ? "off" : undefined}
      className="h-8 rounded-md bg-white/[0.02] text-xs"
      id={`deployment-input-${input.key}`}
      name={input.key}
      onChange={(event) => onChange(event.currentTarget.value)}
      required={input.required}
      type={controlType}
      value={value}
    />
  );
}

function DeploymentInputField({
  input,
  onChange,
  value,
}: {
  input: DeploymentTaskDeploymentPlanInput;
  onChange: (value: string) => void;
  value: string;
}) {
  const label = input.label?.trim() || input.key;
  const description = input.description?.trim();
  const controlType = deploymentInputControlType(input);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label
        className="flex items-center gap-1 font-medium text-foreground text-xs leading-4"
        htmlFor={`deployment-input-${input.key}`}
      >
        {label}
        {input.required ? (
          <span className="text-destructive" title="Required">
            *
          </span>
        ) : null}
      </label>
      {description ? (
        <span className="text-muted-foreground text-xs leading-4">
          {description}
        </span>
      ) : null}
      <DeploymentInputControl
        controlType={controlType}
        input={input}
        onChange={onChange}
        value={value}
      />
    </div>
  );
}

function DeploymentConfigurationForm({
  kubeconfig,
  namespace,
  snapshot,
}: {
  kubeconfig: string;
  namespace: string;
  snapshot: DeploymentTaskTimelineSnapshotDTO;
}) {
  const plan = snapshot.task.artifactSummary.deploymentPlan;
  const hasBlockingInputs =
    snapshot.task.blockingInputs.length > 0 ||
    (plan?.missingInputKeys?.length ?? 0) > 0;
  const showForm =
    (snapshot.task.status === "blocked" || snapshot.task.status === "failed") &&
    snapshot.task.phase === "configure" &&
    hasBlockingInputs;
  const [values, setValues] = useState<Record<string, string>>({});
  const inputs = useMemo(
    () =>
      blockingPlanInputs({
        blockingInputs: snapshot.task.blockingInputs,
        plan,
      }),
    [plan, snapshot.task.blockingInputs]
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!showForm) {
      setValues({});
      return;
    }
    const initialValues = Object.fromEntries(
      inputs.map((input) => [
        input.key,
        plan?.args?.[input.key] ?? inputInitialValue(input),
      ])
    );
    setValues(initialValues);
  }, [inputs, plan, showForm]);

  if (!showForm || inputs.length === 0) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedValues = deploymentInputFormValues({
      fallbackValues: values,
      formData: new FormData(event.currentTarget),
      inputs,
    });
    const missingRequiredInputs = missingRequiredDeploymentInputs(
      inputs,
      submittedValues
    );
    if (missingRequiredInputs.length > 0) {
      setError(
        `Fill required values: ${missingRequiredInputs
          .map((input) => input.label?.trim() || input.key)
          .join(", ")}.`
      );
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/deploy-tasks/${encodeURIComponent(snapshot.task.id)}/input`,
        {
          body: JSON.stringify({
            encodedKubeconfig: kubeconfig,
            namespace,
            values: submittedValues,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to submit deployment input.");
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to submit deployment input."
      );
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="flex min-w-0 flex-col gap-3 rounded-md border border-white/8 bg-white/[0.06] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      data-slot="deployment-configuration-form"
      onSubmit={submit}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AlertTriangle aria-hidden className="size-4 shrink-0 text-amber-400" />
        <h3 className="truncate font-medium text-foreground text-sm leading-5">
          Deployment configuration
        </h3>
      </div>
      <p className="text-muted-foreground text-xs leading-4">
        Required template values are missing. Submit them to continue this
        deployment.
      </p>
      <div className="flex flex-col gap-3">
        {inputs.map((input) => (
          <DeploymentInputField
            input={input}
            key={input.key}
            onChange={(nextValue) =>
              setValues((current) => ({
                ...current,
                [input.key]: nextValue,
              }))
            }
            value={values[input.key] ?? ""}
          />
        ))}
      </div>
      {error == null ? null : (
        <p className="text-destructive text-xs leading-4">{error}</p>
      )}
      <Button
        className="h-7 w-full text-xs"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? (
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <Send aria-hidden className="size-3.5" />
        )}
        Continue deployment
      </Button>
    </form>
  );
}

function orderedSteps(
  timeline: DeploymentTaskTimelineSnapshot
): DeploymentTimelineStep[] {
  return [...timeline.steps].sort((a, b) => a.order - b.order);
}

function deploymentConfigurationStepId(
  steps: readonly DeploymentTimelineStep[]
): string | null {
  return (
    steps.find((step) => step.status === "blocked")?.id ??
    steps.at(-1)?.id ??
    null
  );
}

function timelineTaskStatusLabel(snapshot: DeploymentTaskTimelineSnapshotDTO) {
  return `${snapshot.task.status}${
    snapshot.task.phase ? ` - ${snapshot.task.phase}` : ""
  }`;
}

export function DeploymentTaskTimelinePaneContent({
  kubeconfig,
  namespace,
  snapshot,
}: {
  kubeconfig: string;
  namespace: string;
  snapshot: DeploymentTaskTimelineSnapshotDTO;
}) {
  const steps = orderedSteps(snapshot.timeline);
  if (steps.length === 0) {
    return <EmptyState>No timeline steps have been declared yet.</EmptyState>;
  }
  const configurationStepId = deploymentConfigurationStepId(steps);
  return (
    <div
      className="relative overflow-hidden rounded-lg bg-white/[0.05] px-4 py-4 shadow-[0_1px_3px_0_rgba(0,0,0,0.10),0_1px_2px_0_rgba(0,0,0,0.06)]"
      data-slot="deployment-task-timeline"
    >
      <TimelineBorderBeam />
      <div className="pointer-events-none absolute inset-px rounded-[calc(var(--radius-lg)-1px)] border border-white/8" />
      <div className="mb-3 flex items-center gap-2 text-foreground">
        <Rocket aria-hidden className="size-4 text-foreground" />
        <h3 className="font-medium text-base leading-5">Deployment Timeline</h3>
      </div>
      <div className="mb-4 flex items-center gap-2 text-muted-foreground text-sm leading-5">
        <span
          aria-hidden
          className={cn(
            "size-2.5 rounded-full",
            statusDotTone(snapshot.timeline.status)
          )}
        />
        <span className="capitalize">{timelineTaskStatusLabel(snapshot)}</span>
      </div>
      {steps.map((step) => (
        <TimelineStepItem key={step.id} step={step}>
          {step.id === configurationStepId ? (
            <DeploymentConfigurationForm
              kubeconfig={kubeconfig}
              namespace={namespace}
              snapshot={snapshot}
            />
          ) : null}
        </TimelineStepItem>
      ))}
    </div>
  );
}

export function DeploymentTaskTimelinePane({
  kubeconfig,
  namespace,
  onClose,
  taskId,
}: DeploymentTaskTimelinePaneProps) {
  const timeline = useDeploymentTaskTimeline({
    kubeconfig,
    namespace,
    taskId,
  });
  const task = timeline.data?.task;

  return (
    <SidePane
      busy={timeline.isLoading}
      closeAriaLabel="Close deployment task timeline"
      icon={<PackageCheck aria-hidden className="size-4 text-blue-400" />}
      label="Deployment task timeline pane"
      onClose={onClose}
      subtitle={
        task == null
          ? `Task ${taskId}`
          : `${task.status}${task.phase ? ` - ${task.phase}` : ""}`
      }
      title="Deployment Timeline"
    >
      {timeline.error == null ? null : (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {timeline.error.message}
        </div>
      )}
      {timeline.isReconnecting ? (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground text-sm">
          Reconnecting to timeline updates.
        </div>
      ) : null}
      {timeline.data == null ? (
        <EmptyState>Loading deployment timeline.</EmptyState>
      ) : (
        <DeploymentTaskTimelinePaneContent
          kubeconfig={kubeconfig}
          namespace={namespace}
          snapshot={timeline.data}
        />
      )}
    </SidePane>
  );
}
