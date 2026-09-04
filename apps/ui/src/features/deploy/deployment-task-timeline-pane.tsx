"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { AppSelect } from "@workspace/ui/components/app-select";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { SidePane, SidePaneFooter } from "@workspace/ui/components/side-pane";
import { useStatusHeartbeat } from "@workspace/ui/lib/status-heartbeat";
import { cn } from "@workspace/ui/lib/utils";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  LoaderCircle,
  PackageCheck,
  PencilLine,
  Rocket,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import {
  type ComponentPropsWithoutRef,
  type FormEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { deploymentBillingInterruption } from "@/features/deploy/deploy-billing-interruption";
import { DeploymentBillingInterruptionCard } from "@/features/deploy/deploy-billing-interruption-card";
import { useCancelConfirmGate } from "@/features/deploy/deployment-task-cancel";
import {
  editRedeploySurfaceKind,
  useRedeployOverwriteGate,
} from "@/features/deploy/deployment-task-redeploy";
import { useDeploymentTaskSuccessCelebration } from "@/features/deploy/deployment-task-success-celebration";
import { DeploymentTaskSuccessConfetti } from "@/features/deploy/deployment-task-success-confetti";
import { DeploymentTaskSuccessSection } from "@/features/deploy/deployment-task-success-section";
import { deploymentFailureTechnicalDetail } from "@/features/deploy/task/failure-details";
import {
  deploymentTaskShortCode,
  deploymentTaskSourceSummary,
} from "@/features/deploy/task/projection";
import {
  type DeployTaskStatusHue,
  deployTaskHasAppliedResources,
  deployTaskIsCancellable,
  deployTaskIsCancelling,
  deployTaskIsRedeployable,
  deployTaskStatusHue,
} from "@/features/deploy/task/status-presentation";
import type {
  DeploymentResultResourceCard,
  DeploymentResultResourceCardStatus,
  DeploymentResultResourceRef,
  DeploymentTimelineEvent,
  DeploymentTimelineEventSeverity,
  DeploymentTimelineStep,
  DeploymentTimelineStepStatus,
} from "@/features/deploy/task/timeline";
import type {
  DeploymentTaskDeploymentPlan,
  DeploymentTaskDeploymentPlanInput,
  DeploymentTaskTimelineSnapshotDTO,
  DeployTaskBlockingInput,
  DeployTaskDTO,
  DeployTaskFailureDetails,
  DeployTaskStatus,
} from "@/features/deploy/task/types";
import { useDeploymentTaskActions } from "@/features/deploy/task/use-deployment-task-actions";
import { useDeploymentTaskTimeline } from "@/features/deploy/task/use-deployment-task-timeline";
import { useCopyFeedback } from "@/features/deploy/use-copy-feedback";
import { useStatusHintInputs } from "@/features/status-hint/use-status-hint-inputs";

interface DeploymentTaskTimelinePaneProps {
  kubeconfig: string;
  namespace: string;
  onClose: () => void;
  /** Opens the matching deployment pane prefilled from this task (US10). */
  onEditRedeploy?: (task: DeployTaskDTO) => void;
  taskId: string;
}

type StepOrCardStatus =
  | DeploymentResultResourceCardStatus
  | DeploymentTimelineStepStatus;

type StatusHue = DeployTaskStatusHue;

/**
 * Task statuses take their hue from the shared presentation module; steps
 * share its semantics (running is progress, so blue). Result resource cards
 * differ on one point: a running resource is up — success, not progress.
 */
function stepStatusHue(status: StepOrCardStatus): StatusHue {
  switch (status) {
    case "completed":
      return "green";
    case "creating":
    case "pending":
    case "running":
      return "blue";
    case "blocked":
    case "unknown":
      return "yellow";
    case "failed":
      return "red";
    case "skipped":
      return "neutral";
    default:
      return status satisfies never;
  }
}

function resourceCardStatusHue(
  status: DeploymentResultResourceCardStatus
): StatusHue {
  return status === "running" ? "green" : stepStatusHue(status);
}

const STATUS_DOT_BG: Record<StatusHue, string> = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  neutral: "bg-muted-foreground/50",
  red: "bg-red-500",
  yellow: "bg-amber-500",
};

const STATUS_ICON_TEXT: Record<StatusHue, string> = {
  blue: "text-blue-500",
  green: "text-emerald-500",
  neutral: "text-muted-foreground",
  red: "text-red-500",
  yellow: "text-amber-500",
};

type StepIconStatus =
  | "blocked"
  | "completed"
  | "failed"
  | "skipped"
  | "unknown";

function stepStatusUsesDot(
  status: StepOrCardStatus
): status is "creating" | "pending" | "running" {
  return status === "creating" || status === "pending" || status === "running";
}

function statusMarkerIcon(status: StepIconStatus) {
  switch (status) {
    case "completed":
      return <CheckCircle2 aria-hidden className="size-3.5" />;
    case "blocked":
    case "unknown":
      return <AlertTriangle aria-hidden className="size-3.5" />;
    case "failed":
      return <XCircle aria-hidden className="size-3.5" />;
    case "skipped":
      return <Circle aria-hidden className="size-3.5" />;
    default:
      return status satisfies never;
  }
}

function StatusPulseDot({
  breathing,
  hue,
}: {
  breathing: boolean;
  hue: StatusHue;
}) {
  useStatusHeartbeat(breathing);
  return (
    <>
      {breathing ? (
        <span
          aria-hidden
          className={cn(
            "status-heartbeat-ping absolute size-2 rounded-full opacity-75",
            STATUS_DOT_BG[hue]
          )}
        />
      ) : null}
      <span
        aria-hidden
        className={cn("relative size-2 rounded-full", STATUS_DOT_BG[hue])}
      />
    </>
  );
}

function StatusMarker({ status }: { status: StepOrCardStatus }) {
  const hue = stepStatusHue(status);
  if (stepStatusUsesDot(status)) {
    return (
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        <span className="sr-only">{status}</span>
        <StatusPulseDot breathing={status === "running"} hue={hue} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center",
        STATUS_ICON_TEXT[hue]
      )}
    >
      <span className="sr-only">{status}</span>
      {statusMarkerIcon(status)}
    </span>
  );
}

function ResourceStatusDot({
  status,
}: {
  status: DeploymentResultResourceCardStatus;
}) {
  const hue = resourceCardStatusHue(status);
  return (
    <span
      aria-hidden
      className="relative flex size-3.5 shrink-0 items-center justify-center"
    >
      <StatusPulseDot breathing={status === "running"} hue={hue} />
    </span>
  );
}

function TaskStatusDot({ status }: { status: DeployTaskStatus }) {
  const hue = deployTaskStatusHue(status);
  return (
    <span
      aria-hidden
      className="relative flex size-3.5 shrink-0 items-center justify-center"
    >
      <StatusPulseDot breathing={status === "running"} hue={hue} />
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

const DEPLOYMENT_TIMELINE_EVENT_TIME_FORMAT = new Intl.DateTimeFormat(
  undefined,
  {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }
);

function formatDeploymentTimelineEventTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return DEPLOYMENT_TIMELINE_EVENT_TIME_FORMAT.format(new Date(timestamp));
}

function ResourceEventLine({
  event,
  showSeverity = false,
}: {
  event: DeploymentTimelineEvent;
  showSeverity?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center text-xs leading-4",
        showSeverity && "gap-2"
      )}
    >
      {showSeverity ? (
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            eventSeverityTone(event.severity)
          )}
        />
      ) : null}
      <div className="flex min-w-0 items-center gap-1">
        <span
          className="w-12 shrink-0 truncate text-muted-foreground"
          title={event.createdAt}
        >
          {formatDeploymentTimelineEventTime(event.createdAt)}
        </span>
        <span className="min-w-0 truncate text-foreground/90">
          {event.message}
        </span>
      </div>
    </div>
  );
}

function ResourceEventList({
  events,
}: {
  events: readonly DeploymentTimelineEvent[];
}) {
  return (
    <ol className="flex flex-col gap-1">
      {events.map((event) => (
        <li key={event.id}>
          <ResourceEventLine event={event} showSeverity />
        </li>
      ))}
    </ol>
  );
}

function DeploymentTimelineCard({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-input/30 shadow-none",
        className
      )}
      {...props}
    />
  );
}

function TimelineBorderBeam() {
  const gradientId = useId();

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-px rounded-[calc(var(--radius-lg)-1px)]"
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
          rx="7"
          ry="7"
          stroke={`url(#${gradientId})`}
          strokeDasharray="18 82"
          strokeLinecap="round"
          strokeWidth="1"
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
          rx="7"
          ry="7"
          stroke={`url(#${gradientId})`}
          strokeDasharray="12 88"
          strokeLinecap="round"
          strokeWidth="1"
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
      return "bg-green-500";
    case "warning":
      return "bg-yellow-500";
    case "error":
      return "bg-red-500";
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
            "grid min-w-0 items-start gap-1 text-xs",
            showSeverity
              ? "grid-cols-[0.5rem_3rem_minmax(0,1fr)]"
              : "grid-cols-[3rem_minmax(0,1fr)]"
          )}
          key={event.id}
        >
          {showSeverity ? (
            <span
              aria-hidden
              className={cn(
                "mt-1 size-2 rounded-full",
                eventSeverityTone(event.severity)
              )}
            />
          ) : null}
          <span
            className="truncate text-muted-foreground text-xs leading-4"
            title={event.createdAt}
          >
            {formatDeploymentTimelineEventTime(event.createdAt)}
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
    case "AccessEndpoint":
      return ref.protocol.toUpperCase();
    case "TemplatePublicAccess":
      return "Public domain";
    case "KubernetesWorkload":
      return ref.workloadKind || "Workload";
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
  const [previousStatus, setPreviousStatus] = useState(status);

  if (status !== previousStatus) {
    setPreviousStatus(status);
    if (manualOpen === null && defaultResourceCardOpen(status)) {
      setAutoOpen(true);
    }
  }

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setManualOpen(nextOpen);
  }, []);

  return {
    onOpenChange: handleOpenChange,
    open: manualOpen ?? autoOpen,
  };
}

const ResultResourceCard = memo(function ResultResourceCard({
  card,
}: {
  card: DeploymentResultResourceCard;
}) {
  const { onOpenChange, open } = useResourceCardOpen(card.status);
  const latestEvent = card.events.at(-1);
  const meta = resultResourceMeta(card);

  return (
    <DeploymentTimelineCard
      className="p-4 transition-colors"
      data-slot="deployment-result-resource-card"
    >
      <Collapsible
        className="flex flex-col gap-4"
        onOpenChange={onOpenChange}
        open={open}
      >
        <CollapsibleTrigger
          className="group/resource-card flex w-full cursor-pointer flex-col gap-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30"
          type="button"
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <ResourceStatusDot status={card.status} />
              <div className="min-w-0 flex-1">
                <div
                  className="truncate font-medium text-foreground text-sm leading-5"
                  title={card.title}
                >
                  {card.title}
                </div>
              </div>
            </div>
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/resource-card:rotate-180"
            />
          </div>
          <div className="flex w-full min-w-0 flex-col gap-1">
            <p className="min-w-0 truncate text-muted-foreground text-xs leading-4">
              {meta}
            </p>
            {latestEvent == null ? null : (
              <ResourceEventLine event={latestEvent} />
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-border border-t pt-4 outline-none">
          {card.events.length === 0 ? (
            <p className="text-muted-foreground text-xs leading-4">
              No resource events recorded yet.
            </p>
          ) : (
            <ResourceEventList events={card.events} />
          )}
        </CollapsibleContent>
      </Collapsible>
    </DeploymentTimelineCard>
  );
});

const FailureDetail = memo(function FailureDetail({
  detail,
}: {
  detail: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimeout.current != null) {
        clearTimeout(copyTimeout.current);
      }
    },
    []
  );

  const copy = useCallback(() => {
    navigator.clipboard
      ?.writeText(detail)
      .then(() => {
        setCopied(true);
        if (copyTimeout.current != null) {
          clearTimeout(copyTimeout.current);
        }
        copyTimeout.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  }, [detail]);

  return (
    <DeploymentTimelineCard
      className="p-4"
      data-slot="deployment-failure-detail"
    >
      <Collapsible
        className="flex flex-col gap-3"
        onOpenChange={setOpen}
        open={open}
      >
        <CollapsibleTrigger
          className="group/failure flex w-full cursor-pointer items-center justify-between gap-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30"
          type="button"
        >
          <span className="min-w-0 truncate font-medium text-foreground text-sm leading-5">
            {open ? "Hide error details" : "Show error details"}
          </span>
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/failure:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-border border-t pt-3 outline-none">
          <div className="flex flex-col gap-2">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-input/40 p-3 font-mono text-foreground/90 text-xs leading-4">
              {detail}
            </pre>
            <AppButton
              className="self-end"
              onClick={copy}
              type="button"
              variant="secondary"
            >
              {copied ? (
                <Check aria-hidden data-icon="inline-start" />
              ) : (
                <Copy aria-hidden data-icon="inline-start" />
              )}
              {copied ? "Copied" : "Copy"}
            </AppButton>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </DeploymentTimelineCard>
  );
});

const TimelineStepItem = memo(function TimelineStepItem({
  children,
  step,
}: {
  children?: ReactNode;
  step: DeploymentTimelineStep;
}) {
  const cards = step.resultCards ?? [];
  const hasEvents = step.events.length > 0;
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <StatusMarker status={step.status} />
        <h3
          className="min-w-0 flex-1 truncate font-normal text-foreground text-sm leading-5"
          title={step.label}
        >
          {step.label}
        </h3>
      </div>
      {hasEvents ? (
        <div className="flex items-stretch gap-1">
          <div className="flex w-3.5 justify-center">
            <span aria-hidden className="w-px self-stretch bg-white/10" />
          </div>
          <div className="min-w-0 flex-1">
            <TimelineEventList events={step.events} />
          </div>
        </div>
      ) : null}
      {cards.length === 0 ? null : (
        <div className="flex flex-col gap-2.5">
          {cards.map((card) => (
            <ResultResourceCard card={card} key={card.id} />
          ))}
        </div>
      )}
      {children ?? null}
    </section>
  );
});

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
  if (input.sensitive || type === "secret" || type === "password") {
    return "password";
  }
  if ((input.options?.length ?? 0) > 0 || type === "choice") {
    return "choice";
  }
  if (type === "boolean") {
    return "boolean";
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
        <AppSelect
          id={controlId}
          onValueChange={onChange}
          options={(input.options ?? []).map((option) => ({
            label: option,
            value: option,
          }))}
          placeholder="Select value"
          value={value}
        />
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
      id={`deployment-input-${input.key}`}
      name={input.key}
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={input.label?.trim() || input.key}
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
    <div className="flex flex-col gap-2 text-sm">
      <label
        className="flex items-center gap-1 font-normal text-foreground text-sm leading-none"
        htmlFor={`deployment-input-${input.key}`}
      >
        {label}
        {input.required ? (
          <span className="text-red-500" title="Required">
            *
          </span>
        ) : null}
      </label>
      {description ? (
        <span className="text-muted-foreground text-sm leading-5">
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
  blockingInputs,
  kubeconfig,
  namespace,
  plan,
  status,
  taskId,
}: {
  blockingInputs: DeployTaskBlockingInput[];
  kubeconfig: string;
  namespace: string;
  plan: DeploymentTaskDeploymentPlan | undefined;
  status: DeployTaskStatus;
  taskId: string;
}) {
  const hasBlockingInputs =
    blockingInputs.length > 0 || (plan?.missingInputKeys?.length ?? 0) > 0;
  const showForm = status === "blocked" && hasBlockingInputs;
  const [values, setValues] = useState<Record<string, string>>({});
  const inputs = useMemo(
    () => blockingPlanInputs({ blockingInputs, plan }),
    [blockingInputs, plan]
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previousValuesKey, setPreviousValuesKey] = useState<{
    inputs: typeof inputs;
    plan: typeof plan;
    showForm: boolean;
  } | null>(null);

  if (
    previousValuesKey === null ||
    previousValuesKey.inputs !== inputs ||
    previousValuesKey.plan !== plan ||
    previousValuesKey.showForm !== showForm
  ) {
    setPreviousValuesKey({ inputs, plan, showForm });
    setValues(
      showForm
        ? Object.fromEntries(
            inputs.map((input) => [
              input.key,
              plan?.args?.[input.key] ?? inputInitialValue(input),
            ])
          )
        : {}
    );
  }

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
        `/api/deploy-tasks/${encodeURIComponent(taskId)}/input`,
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
    <DeploymentTimelineCard data-slot="deployment-configuration-form">
      <form className="flex min-w-0 flex-col gap-[14px] p-4" onSubmit={submit}>
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle
              aria-hidden
              className="size-4 shrink-0 text-yellow-500"
            />
            <h3 className="truncate font-medium text-foreground text-sm leading-5">
              Deployment configuration
            </h3>
          </div>
          <p className="text-muted-foreground text-sm leading-5">
            Required template values are missing. Submit them to continue this
            deployment.
          </p>
        </div>
        <div className="flex flex-col gap-3.5">
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
        <AppButton className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? (
            <LoaderCircle
              aria-hidden
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : (
            <Rocket aria-hidden data-icon="inline-start" />
          )}
          Continue Deployment
        </AppButton>
      </form>
    </DeploymentTimelineCard>
  );
}

function orderedSteps(
  steps: readonly DeploymentTimelineStep[]
): DeploymentTimelineStep[] {
  return [...steps].sort((a, b) => a.order - b.order);
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

function TimelineTaskIdRow({ taskId }: { taskId: string }) {
  const [copied, copyTaskId] = useCopyFeedback(taskId);

  return (
    <div
      className="group/task-id relative mb-2.5 flex items-center justify-between gap-2 rounded-md border border-border bg-input/30 px-3 py-2 transition-colors hover:bg-input"
      data-slot="deployment-task-id"
    >
      <button
        aria-label={copied ? "Task ID copied" : "Copy task ID"}
        className="absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={copyTaskId}
        title={taskId}
        type="button"
      />
      <p className="flex min-w-0 items-center gap-2 text-foreground text-sm leading-5">
        <span className="shrink-0">Task ID:</span>
        <span className="truncate">{taskId}</span>
      </p>
      {copied ? (
        <Check aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <Copy
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/task-id:opacity-100"
        />
      )}
    </div>
  );
}

/**
 * Memo boundary for the step/card subtree. It consumes only values the client
 * `reconcile` keeps referentially stable across an unchanged SSE tick (`steps`
 * plus the form's blocking inputs / plan), so a no-op readiness tick — which
 * still bumps `revision`/`updatedAt`/`task.updatedAt` in the envelope — bails
 * the whole subtree instead of re-rendering every step and card. The config
 * form takes explicit stable props rather than the churning `snapshot` so it
 * neither drags the envelope through this memo nor resets user entry.
 */
const TimelineSteps = memo(function TimelineSteps({
  blockingInputs,
  failureDetail,
  failureDetails,
  kubeconfig,
  namespace,
  plan,
  status,
  steps,
  taskId,
}: {
  blockingInputs: DeployTaskBlockingInput[];
  failureDetail: string | undefined;
  failureDetails: DeployTaskFailureDetails | null;
  kubeconfig: string;
  namespace: string;
  plan: DeploymentTaskDeploymentPlan | undefined;
  status: DeployTaskStatus;
  steps: readonly DeploymentTimelineStep[];
  taskId: string;
}) {
  const ordered = useMemo(() => orderedSteps(steps), [steps]);
  const configurationStepId = deploymentConfigurationStepId(ordered);
  // A money or quota wall gets its own callout under the failed step
  // (design spec §5.4); the error details stay collapsed beneath it. The
  // quota CTA forks on the same reads the status hint already holds.
  const hintInputs = useStatusHintInputs();
  const interruption = useMemo(
    () =>
      deploymentBillingInterruption(failureDetails, {
        payg: hintInputs.subscription?.isPayg ?? null,
        planCeiling: hintInputs.planCeiling ?? null,
      }),
    [failureDetails, hintInputs]
  );
  return (
    <div className="flex flex-col gap-4">
      {ordered.map((step) => (
        <TimelineStepItem key={step.id} step={step}>
          {step.id === configurationStepId ? (
            <DeploymentConfigurationForm
              blockingInputs={blockingInputs}
              kubeconfig={kubeconfig}
              namespace={namespace}
              plan={plan}
              status={status}
              taskId={taskId}
            />
          ) : null}
          {step.status === "failed" && interruption != null ? (
            <DeploymentBillingInterruptionCard interruption={interruption} />
          ) : null}
          {step.status === "failed" && failureDetail != null ? (
            <FailureDetail detail={failureDetail} />
          ) : null}
        </TimelineStepItem>
      ))}
    </div>
  );
});

/**
 * The Timeline surface: declared steps, then — once the runner has verified
 * the product is usable — the success conclusion.
 */
export function DeploymentTaskTimelinePaneContent({
  kubeconfig,
  namespace,
  snapshot,
}: {
  kubeconfig: string;
  namespace: string;
  snapshot: DeploymentTaskTimelineSnapshotDTO;
}) {
  // Only the runner may claim success (Result Readiness + every required entry
  // probe passed); the status check is a belt for a persisted or hand-built
  // snapshot, so a non-completed task can never show the card.
  const success =
    snapshot.timeline.status === "completed"
      ? (snapshot.timeline.success ?? null)
      : null;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const celebrating = useDeploymentTaskSuccessCelebration({
    successRevision: success?.revision ?? null,
    taskId: snapshot.task.id,
  });
  if (snapshot.timeline.steps.length === 0 && success == null) {
    return <EmptyState>No timeline steps have been declared yet.</EmptyState>;
  }
  const failureDetail = deploymentFailureTechnicalDetail({
    details: snapshot.task.failureDetails,
    error: snapshot.task.error,
    id: snapshot.task.id,
    phase: snapshot.task.phase,
    runner: snapshot.task.runner,
    status: snapshot.task.status,
  });
  const steps = (
    <TimelineSteps
      blockingInputs={snapshot.task.blockingInputs}
      failureDetail={failureDetail}
      failureDetails={snapshot.task.failureDetails}
      kubeconfig={kubeconfig}
      namespace={namespace}
      plan={snapshot.task.artifactSummary.deploymentPlan}
      status={snapshot.task.status}
      steps={snapshot.timeline.steps}
      taskId={snapshot.task.id}
    />
  );
  const hasSteps = snapshot.timeline.steps.length > 0;
  return (
    <div
      className="relative overflow-hidden rounded-lg bg-white/[0.05] px-4 py-4"
      data-slot="deployment-task-timeline"
    >
      <TimelineBorderBeam />
      <div className="pointer-events-none absolute inset-px rounded-[calc(var(--radius-lg)-1px)] border" />
      <DeploymentTaskSuccessConfetti active={celebrating} />
      <div className="mb-2.5 flex items-center gap-2 text-foreground">
        <Rocket aria-hidden className="size-4 text-foreground" />
        <h3 className="font-medium text-sm leading-5">Deployment Timeline</h3>
      </div>
      <TimelineTaskIdRow taskId={snapshot.task.id} />
      <div className="mb-4 flex items-center gap-2 text-muted-foreground text-sm leading-5">
        <TaskStatusDot status={snapshot.timeline.status} />
        <span className="capitalize">{timelineTaskStatusLabel(snapshot)}</span>
      </div>
      {hasSteps && success == null ? steps : null}
      {hasSteps && success != null ? (
        // The process recedes, the result takes the panel. `keepMounted` so
        // collapsing hides the steps without destroying them: they stay
        // readable to a screen reader and one click away for everyone else.
        <Collapsible
          className="flex flex-col"
          onOpenChange={setDetailsOpen}
          open={detailsOpen}
        >
          <CollapsibleTrigger
            className="group/timeline-details flex w-full cursor-pointer items-center justify-between gap-3 rounded-md text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30"
            type="button"
          >
            <span className="min-w-0 truncate text-muted-foreground text-sm leading-5">
              {detailsOpen
                ? "Hide deployment details"
                : "View deployment details"}
            </span>
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/timeline-details:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 outline-none" keepMounted>
            {steps}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {success == null ? null : (
        <DeploymentTaskSuccessSection success={success} />
      )}
    </div>
  );
}

export function DeploymentTaskTimelineActions({
  kubeconfig,
  namespace,
  onEditRedeploy,
  task,
}: {
  kubeconfig: string;
  namespace: string;
  onEditRedeploy?: (task: DeployTaskDTO) => void;
  task: DeployTaskDTO;
}) {
  const actions = useDeploymentTaskActions({ kubeconfig, namespace });
  const cancelGate = useCancelConfirmGate();
  const cancellable = deployTaskIsCancellable(task.status);
  const redeployable = deployTaskIsRedeployable(task.status);
  const cancelling =
    deployTaskIsCancelling(task) || actions.cancelPendingTaskIds.has(task.id);
  const redeployPending = actions.redeployPendingTaskIds.has(task.id);
  const overwriteGate = useRedeployOverwriteGate(
    deployTaskHasAppliedResources(task)
  );
  const editable =
    redeployable &&
    onEditRedeploy != null &&
    editRedeploySurfaceKind(task.source.kind) != null;
  // Task lifecycle actions are pane-level (US14/15): inside the timeline pane
  // they pin in the Side Pane Footer; chrome-less hosts keep the row in place.
  return (
    <SidePaneFooter>
      <div
        className="flex items-center justify-end gap-2.5"
        data-slot="deployment-task-actions"
      >
        <AppButton
          disabled={!cancellable || cancelling}
          onClick={() => {
            cancelGate.gate(() => {
              actions.cancel(task.id).catch(() => undefined);
            });
          }}
          type="button"
          variant="secondary"
        >
          {cancelling ? (
            <>
              <LoaderCircle
                aria-hidden
                className="animate-spin"
                data-icon="inline-start"
              />
              Cancelling…
            </>
          ) : (
            <>
              <X aria-hidden data-icon="inline-start" />
              Cancel Deployment
            </>
          )}
        </AppButton>
        {cancelGate.dialog}
        {editable ? (
          <AppButton
            disabled={redeployPending}
            onClick={() => {
              onEditRedeploy(task);
            }}
            type="button"
            variant="secondary"
          >
            <PencilLine aria-hidden data-icon="inline-start" />
            Edit & Redeploy
          </AppButton>
        ) : null}
        {redeployable ? (
          <AppButton
            disabled={redeployPending}
            onClick={() => {
              overwriteGate.gate(() => {
                actions
                  .redeploy(task.id, task.source.kind)
                  .catch(() => undefined);
              });
            }}
            type="button"
            variant="secondary"
          >
            {redeployPending ? (
              <>
                <LoaderCircle
                  aria-hidden
                  className="animate-spin"
                  data-icon="inline-start"
                />
                Redeploying…
              </>
            ) : (
              <>
                <RotateCcw aria-hidden data-icon="inline-start" />
                Redeploy
              </>
            )}
          </AppButton>
        ) : null}
        {overwriteGate.dialog}
      </div>
    </SidePaneFooter>
  );
}

const DEPLOYMENT_TIMELINE_PANE_ICON = (
  <PackageCheck aria-hidden className="size-4 text-blue-400" />
);

interface DeploymentTaskPaneIdentity {
  subtitle: string;
  title: string;
}

/**
 * The pane's stable identity — the source summary as a human-readable title,
 * with a short task-id code (the same one the dock chip that opened this pane
 * shows, so the two cross-reference) and the absolute start time as the
 * subtitle. Both parts are stable for a task's life (an absolute start time,
 * not a drifting "3 min ago"), so the header can be resolved once and frozen
 * (see DeploymentTaskTimelineBody: the header must not repaint on a stream
 * tick). The destination project is intentionally omitted — the pane already
 * renders inside that project's canvas.
 */
function deploymentTaskPaneIdentity(
  task: DeployTaskDTO
): DeploymentTaskPaneIdentity {
  const time = formatDeploymentTimelineEventTime(
    task.startedAt ?? task.createdAt
  );
  return {
    subtitle: `#${deploymentTaskShortCode(task.id)} · ${time}`,
    title: deploymentTaskSourceSummary(task.source),
  };
}

/**
 * Owns the timeline subscription. It is deliberately a child of the SidePane
 * shell (not its parent): a stream tick re-renders this body in place without
 * re-rendering the `SidePane` above it, so the header — icon, title, close
 * button — never repaints on a tick. The live task status shows here (the
 * status row in `DeploymentTaskTimelinePaneContent`), so the shell can keep a
 * static subtitle.
 */
function DeploymentTaskTimelineBody({
  kubeconfig,
  namespace,
  onEditRedeploy,
  onIdentity,
  taskId,
}: {
  kubeconfig: string;
  namespace: string;
  onEditRedeploy?: (task: DeployTaskDTO) => void;
  onIdentity: (identity: DeploymentTaskPaneIdentity) => void;
  taskId: string;
}) {
  const timeline = useDeploymentTaskTimeline({ kubeconfig, namespace, taskId });
  const task = timeline.data?.task;

  // Report the header identity up once it resolves. `task` gets a fresh
  // reference every tick, so guard on the identity value: this fires only when
  // the (stable) identity actually changes, keeping the frozen header off the
  // per-tick render path.
  const sentIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    if (task == null) {
      return;
    }
    const identity = deploymentTaskPaneIdentity(task);
    const key = `${identity.title} ${identity.subtitle}`;
    if (sentIdentityRef.current === key) {
      return;
    }
    sentIdentityRef.current = key;
    onIdentity(identity);
  }, [task, onIdentity]);

  return (
    <>
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
      {task == null ? null : (
        <DeploymentTaskTimelineActions
          kubeconfig={kubeconfig}
          namespace={namespace}
          onEditRedeploy={onEditRedeploy}
          task={task}
        />
      )}
    </>
  );
}

export function DeploymentTaskTimelinePane({
  kubeconfig,
  namespace,
  onClose,
  onEditRedeploy,
  taskId,
}: DeploymentTaskTimelinePaneProps) {
  // Keyed by taskId so a reused pane never shows the previous task's identity:
  // a stale entry is ignored until the new task resolves its own.
  const [resolved, setResolved] = useState<{
    identity: DeploymentTaskPaneIdentity;
    taskId: string;
  } | null>(null);
  const handleIdentity = useCallback(
    (identity: DeploymentTaskPaneIdentity) => {
      setResolved({ identity, taskId });
    },
    [taskId]
  );
  const identity = resolved?.taskId === taskId ? resolved.identity : null;

  return (
    <SidePane
      closeAriaLabel="Close deployment task timeline"
      icon={DEPLOYMENT_TIMELINE_PANE_ICON}
      label="Deployment task timeline pane"
      onClose={onClose}
      subtitle={identity?.subtitle}
      title={identity?.title ?? "Deployment Timeline"}
    >
      <DeploymentTaskTimelineBody
        key={taskId}
        kubeconfig={kubeconfig}
        namespace={namespace}
        onEditRedeploy={onEditRedeploy}
        onIdentity={handleIdentity}
        taskId={taskId}
      />
    </SidePane>
  );
}
