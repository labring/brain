"use client";

import {
  CanvasNode,
  type CanvasNodeMetricListItem,
} from "@workspace/ui/components/canvas-node/canvas-node";
import { canvasNodeActionWithAvailability } from "@workspace/ui/components/canvas-node/canvas-node.availability";
import { DatabaseEngineIcon } from "@workspace/ui/components/database-engine-icon";
import { Switch } from "@workspace/ui/components/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  Activity,
  Cpu,
  FileText,
  HardDrive,
  MemoryStick,
  Pause,
  Play,
  RotateCcw,
  SquareTerminal,
  TableProperties,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";

import {
  databaseNodeLifecycleAvailability,
  databaseNodeQuickActionAvailability,
} from "./database-node.availability";
import { useDatabaseNode } from "./database-node.context";
import { maskDatabaseConnectionString } from "./database-node.mask";
import {
  canCopyDatabaseNodeConnection,
  getDatabaseNodeConnectionKey,
} from "./database-node.root";
import { resolveDatabaseNodeStatus } from "./database-node.status";
import type {
  DatabaseNodeConnection,
  DatabaseNodeLifecycleActionKey,
  DatabaseNodeMetricKey,
  DatabaseNodePublicConnection,
  DatabaseNodeQuickActionKey,
  DatabaseNodeStates,
} from "./database-node.types";

const METRIC_ITEMS = [
  { icon: Cpu, key: "cpu", label: "CPU" },
  { icon: MemoryStick, key: "memory", label: "Memory" },
  { icon: HardDrive, key: "storage", label: "Storage" },
] as const satisfies readonly CanvasNodeMetricListItem<DatabaseNodeMetricKey>[];

const QUICK_ACTION_ITEMS = [
  { icon: Activity, key: "metrics", label: "Open metrics", tooltip: "Metrics" },
  {
    icon: SquareTerminal,
    key: "terminal",
    label: "Open terminal",
    tooltip: "Terminal",
  },
  { icon: FileText, key: "logs", label: "Open logs", tooltip: "Logs" },
  {
    icon: TableProperties,
    key: "dbAccess",
    label: "Open database access",
    tooltip: "Database access",
  },
] as const satisfies readonly {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  key: DatabaseNodeQuickActionKey;
  label: string;
  tooltip: string;
}[];

interface LifecycleActionItem {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  key: DatabaseNodeLifecycleActionKey;
  label: string;
  tone?: "destructive" | "info" | "muted" | "success";
}

const LIFECYCLE_ACTION_ITEMS: readonly LifecycleActionItem[] = [
  { icon: Play, key: "start", label: "Start", tone: "success" },
  { icon: Pause, key: "stop", label: "Stop", tone: "muted" },
  { icon: RotateCcw, key: "restart", label: "Restart", tone: "info" },
  { icon: Trash2, key: "delete", label: "Delete", tone: "destructive" },
] as const;

function formatDatabaseSubtitle({
  displayEngine,
  formattedVersion,
}: {
  displayEngine: string;
  formattedVersion?: string;
}) {
  return `Database ${displayEngine}${formattedVersion ? ` ${formattedVersion}` : ""}`;
}

function getConnectionDisplayValue(connection: DatabaseNodeConnection) {
  if (connection.kind === "public" && !connection.publicAccess.enabled) {
    return null;
  }

  if (connection.value) {
    return (
      connection.displayValue ?? maskDatabaseConnectionString(connection.value)
    );
  }

  if (connection.kind === "public") {
    return connection.provisioningMessage ?? "Provisioning connection string";
  }

  return connection.unavailableMessage ?? "Connection unavailable";
}

function DatabaseNodeConnectionValueText({
  displayValue,
  value,
}: {
  displayValue: string;
  value?: string;
}) {
  if (!value || displayValue !== maskDatabaseConnectionString(value)) {
    return <span className="min-w-0 truncate">{displayValue}</span>;
  }

  return (
    <>
      <span className="min-w-0 truncate group-focus-within/copyable-row:hidden group-hover/copyable-row:hidden">
        {displayValue}
      </span>
      <span className="hidden min-w-0 truncate group-focus-within/copyable-row:inline group-hover/copyable-row:inline">
        {value}
      </span>
    </>
  );
}

function databaseNodeConnectionTitle(
  displayValue: string | null,
  value?: string
) {
  if (value && displayValue === maskDatabaseConnectionString(value)) {
    return "";
  }
  return displayValue ?? undefined;
}

export function DatabaseNodeContent({
  metricsContent,
}: {
  metricsContent?: ReactNode;
}) {
  return (
    <CanvasNode.Card surfaceClassName="database-node-surface">
      <CanvasNode.Header>
        <DatabaseNodeHeaderContent />
      </CanvasNode.Header>
      <CanvasNode.Body>
        <DatabaseNodeBodyContent />
      </CanvasNode.Body>
      <CanvasNode.Footer>
        <DatabaseNodeFooterContent metricsContent={metricsContent} />
      </CanvasNode.Footer>
    </CanvasNode.Card>
  );
}

export function DatabaseNodeDeletionDelayHint({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "database-node-deletion-delay-hint pointer-events-none flex w-[267px] flex-col items-start justify-center gap-4 overflow-hidden rounded-lg border-[0.5px] border-border bg-white/5 p-2.5 text-muted-foreground backdrop-blur-[20px]",
        className
      )}
      data-slot="database-node-deletion-delay-hint"
    >
      <div className="flex w-full items-start gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
          <TriangleAlert
            aria-hidden
            className="size-3.5 text-yellow-500"
            strokeWidth={2}
          />
        </div>
        <p className="min-w-0 flex-1 text-xs leading-4">
          Your database is being deleted. This may take a few minutes.
        </p>
      </div>
    </div>
  );
}

export function DatabaseNodeHeaderContent({
  className,
}: {
  className?: string;
}) {
  const {
    state: { states },
  } = useDatabaseNode();
  const subtitle = formatDatabaseSubtitle(states);

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
          <DatabaseEngineIcon
            className="size-4 shrink-0 object-contain text-blue-400"
            engine={states.engineKey}
            iconUrl={states.iconUrl}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span
            className="min-w-0 truncate font-normal text-sm text-zinc-50 leading-5"
            title={states.name}
          >
            {states.name}
          </span>
          <span
            className="min-w-0 truncate font-normal text-muted-foreground text-xs leading-4"
            title={subtitle}
          >
            {subtitle}
          </span>
        </span>
      </span>
      <DatabaseNodeHeaderMenu />
    </div>
  );
}

export function DatabaseNodeBodyContent({ className }: { className?: string }) {
  return (
    <div className={cn("database-node-body-content pt-2.5", className)}>
      <DatabaseNodeConnectionList />
      <DatabaseNodeActionBar />
    </div>
  );
}

export function DatabaseNodeConnectionList({
  className,
}: {
  className?: string;
}) {
  const {
    state: { connections = [] },
  } = useDatabaseNode();
  const scrollable = connections.length > 2;

  if (connections.length === 0) {
    return (
      <div
        className={cn(
          "database-node-connection-empty flex min-w-0 items-center rounded-lg bg-zinc-950/20 px-2.5 text-muted-foreground text-xs leading-4",
          className
        )}
        data-slot="database-node-connection-empty"
      >
        No connections
      </div>
    );
  }

  return (
    <div
      className={cn(
        "database-node-connection-list flex min-w-0 flex-col gap-2",
        className
      )}
      data-scrollable={scrollable || undefined}
      data-slot="database-node-connection-list"
    >
      {connections.map((connection, index) => (
        <DatabaseNodeConnectionRow
          connection={connection}
          index={index}
          key={getDatabaseNodeConnectionKey(connection, index)}
        />
      ))}
    </div>
  );
}

export function DatabaseNodeConnectionRow({
  className,
  connection,
  index,
}: {
  className?: string;
  connection: DatabaseNodeConnection;
  index: number;
}) {
  const { actions } = useDatabaseNode();
  const copyable = canCopyDatabaseNodeConnection(connection);
  const displayValue = getConnectionDisplayValue(connection);
  const connectionTitle = databaseNodeConnectionTitle(
    displayValue,
    connection.value
  );
  const rowKey = getDatabaseNodeConnectionKey(connection, index);
  const publicSwitch =
    connection.kind === "public" ? (
      <CanvasNode.CopyableRowControl className="pointer-events-auto relative z-20 flex shrink-0 items-center">
        <DatabaseNodePublicSwitch connection={connection} index={index} />
      </CanvasNode.CopyableRowControl>
    ) : null;

  return (
    <CanvasNode.CopyableRow
      className={cn(
        "database-node-connection-row relative flex min-w-0 flex-col gap-2 rounded-lg bg-zinc-950/20 p-2.5 transition-colors",
        displayValue ? "min-h-18" : "min-h-11",
        !copyable && "database-node-connection-row-static",
        className
      )}
      copyAriaLabel={`Copy ${connection.label}`}
      copyable={copyable}
      copyValue={connection.value}
      data-slot="database-node-connection-row"
      onCopy={
        actions.copyConnection
          ? () => actions.copyConnection?.(connection, index)
          : undefined
      }
      rowKey={rowKey}
      title={connectionTitle}
    >
      {({ copied, copyable: rowCopyable }) => (
        <>
          <div
            className={cn(
              "relative z-10 flex min-w-0 items-center justify-between gap-2",
              rowCopyable ? "pointer-events-none" : "pointer-events-auto"
            )}
          >
            <span className="min-w-0 truncate font-normal text-muted-foreground text-xs leading-4">
              {connection.label}
            </span>
            {publicSwitch}
          </div>
          {displayValue ? (
            <div
              aria-hidden={rowCopyable ? true : undefined}
              className={cn(
                "relative z-10 flex h-7 min-w-0 items-center justify-between gap-2 py-1.5 text-left font-normal text-xs leading-4",
                rowCopyable
                  ? "pointer-events-none text-zinc-50"
                  : "text-muted-foreground"
              )}
              data-copied={copied ? "true" : undefined}
              data-slot="database-node-connection-value"
              title={connectionTitle}
            >
              <DatabaseNodeConnectionValueText
                displayValue={displayValue}
                value={connection.value}
              />
              <CanvasNode.CopyableRowIndicator />
            </div>
          ) : null}
        </>
      )}
    </CanvasNode.CopyableRow>
  );
}

function DatabaseNodePublicSwitch({
  connection,
  index,
}: {
  connection: DatabaseNodePublicConnection;
  index: number;
}) {
  const { actions } = useDatabaseNode();
  const disabled =
    connection.publicAccess.loading || !actions.togglePublicConnection;
  const disabledReason = actions.togglePublicConnection
    ? undefined
    : actions.togglePublicConnectionDisabledReason;

  const control = (
    <Switch
      aria-description={disabledReason}
      aria-label={
        connection.publicAccess.enabled
          ? "Disable public connection"
          : "Enable public connection"
      }
      checked={connection.publicAccess.enabled}
      className={cn(
        "database-node-public-switch pointer-events-auto relative z-20 cursor-pointer data-disabled:cursor-not-allowed data-disabled:opacity-70",
        disabledReason && "pointer-events-none"
      )}
      disabled={disabled}
      onCheckedChange={(nextEnabled) => {
        if (!actions.togglePublicConnection) {
          return;
        }

        Promise.resolve(
          actions.togglePublicConnection(connection, index, nextEnabled)
        ).catch(() => undefined);
      }}
      size="lg"
      variant="brand"
    />
  );

  if (!disabledReason) {
    return control;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex cursor-not-allowed"
            title={disabledReason}
          >
            {control}
          </span>
        }
      />
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

export function DatabaseNodeActionBar({ className }: { className?: string }) {
  const {
    actions: { quickActions },
    state: {
      states: { status },
    },
  } = useDatabaseNode();
  const availability = databaseNodeQuickActionAvailability(
    status?.tone ?? status?.label
  );

  return (
    <CanvasNode.ActionBar className={cn("database-node-action-bar", className)}>
      {QUICK_ACTION_ITEMS.map((item) => {
        const entry = availability[item.key];
        const action =
          entry === undefined
            ? quickActions?.[item.key]
            : canvasNodeActionWithAvailability(quickActions?.[item.key], entry);
        const Icon = item.icon;

        return (
          <CanvasNode.ActionButton
            action={action}
            aria-label={item.label}
            className="database-node-action-button"
            key={item.key}
            title={item.tooltip}
          >
            <Icon aria-hidden className="size-4" />
          </CanvasNode.ActionButton>
        );
      })}
    </CanvasNode.ActionBar>
  );
}

export function DatabaseNodeFooterContent({
  className,
  metricsContent,
}: {
  className?: string;
  metricsContent?: ReactNode;
}) {
  const {
    state: {
      states: { metrics, status },
    },
  } = useDatabaseNode();
  const visualStatus = resolveDatabaseNodeStatus(status);

  return (
    <div
      className={cn(
        "database-node-footer-content flex w-full min-w-0 items-center justify-between gap-2 text-xs leading-none",
        className
      )}
      data-slot="database-node-footer-content"
    >
      <CanvasNode.FooterStatus status={visualStatus} />
      <CanvasNode.Metrics>
        {metricsContent ?? <DatabaseNodeMetricsContent metrics={metrics} />}
      </CanvasNode.Metrics>
    </div>
  );
}

export function DatabaseNodeMetricsContent({
  metrics,
}: {
  metrics?: DatabaseNodeStates["metrics"];
}) {
  return (
    <>
      {METRIC_ITEMS.map((item) => {
        const Icon = item.icon;

        return (
          <CanvasNode.Metric
            format="percent"
            key={item.key}
            label={item.label}
            value={metrics?.[item.key]}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" />
          </CanvasNode.Metric>
        );
      })}
    </>
  );
}

function DatabaseNodeHeaderMenu() {
  const {
    actions: { lifecycleActions },
    state: {
      states: { status },
    },
  } = useDatabaseNode();
  const availability = databaseNodeLifecycleAvailability(
    status?.tone ?? status?.label
  );

  if (lifecycleActions == null) {
    return null;
  }

  return (
    <CanvasNode.ActionMenu aria-label="Open database actions">
      {LIFECYCLE_ACTION_ITEMS.map((item) => {
        const entry = availability[item.key];
        if (!entry.present) {
          return null;
        }

        const action = canvasNodeActionWithAvailability(
          lifecycleActions?.[item.key],
          entry
        );
        const Icon = item.icon;

        return (
          <CanvasNode.ActionMenuItem
            action={action}
            actionKey={item.key}
            icon={<Icon aria-hidden className="size-4" />}
            key={item.key}
            tone={item.tone}
          >
            {item.label}
          </CanvasNode.ActionMenuItem>
        );
      })}
    </CanvasNode.ActionMenu>
  );
}
