"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  CanvasNodeCopyableRow,
  CanvasNodeCopyableRowControl,
  useCanvasNodeCopyableRow,
} from "@workspace/ui/components/canvas-node/canvas-node.copyable-row";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Check, Copy, Eye, EyeClosed } from "lucide-react";
import type { ReactNode } from "react";

import { MASKED_SECRET_VALUE } from "./database-node.mask";
import type { DatabaseNodeConnection } from "./database-node.types";

export type DatabaseConnectionRowVariant = "node" | "settings";

export interface DatabaseConnectionRowProps {
  className?: string;
  connection: DatabaseNodeConnection;
  /** Display label; defaults to the connection's own label. */
  label?: string;
  onCopy?: () => Promise<void> | void;
  /** Enables the eye; absent when no resolver backs the surface. */
  onToggleReveal?: () => Promise<void> | void;
  /** Overrides the connection's public-access state (e.g. a settings draft). */
  publicAccessEnabled?: boolean;
  /** Label-line control on public rows; never participates in copy. */
  publicSwitch?: ReactNode;
  revealedValue?: string;
  rowKey: string;
  variant?: DatabaseConnectionRowVariant;
}

interface DatabaseConnectionRowStyles {
  label: string;
  row: string;
  rowWithoutValue: string;
  rowWithValue: string;
  valueLine: string;
  valueText: string;
}

const ROW_VARIANT_CLASSES: Record<
  DatabaseConnectionRowVariant,
  DatabaseConnectionRowStyles
> = {
  node: {
    label: "text-xs leading-4",
    row: "bg-zinc-950/20 p-2.5",
    rowWithoutValue: "min-h-11",
    rowWithValue: "min-h-18",
    valueLine: "h-7 text-xs leading-4",
    valueText: "text-zinc-50",
  },
  settings: {
    label: "text-sm leading-5",
    row: "bg-white/5 p-4 shadow-sm",
    rowWithoutValue: "min-h-11",
    rowWithValue: "min-h-20",
    valueLine: "h-8 text-sm leading-5",
    valueText: "text-foreground",
  },
};

type DatabaseConnectionRowValueKind =
  | { kind: "message"; text: string }
  | { kind: "secret" }
  | null;

function databaseConnectionRowValueKind(
  connection: DatabaseNodeConnection,
  publicAccessEnabled: boolean
): DatabaseConnectionRowValueKind {
  if (connection.kind === "public" && !publicAccessEnabled) {
    return null;
  }
  if (connection.value) {
    return { kind: "secret" };
  }
  if (connection.kind === "public") {
    return {
      kind: "message",
      text: connection.provisioningMessage ?? "Provisioning connection string",
    };
  }
  return {
    kind: "message",
    text: connection.unavailableMessage ?? "Connection unavailable",
  };
}

/**
 * The one DB connection row anatomy shared by the canvas DB node and DB
 * Settings (ADR-0054): label plus optional public switch on the top line;
 * fixed `*******` mask, eye, and copy on the value line. The eye swaps the
 * revealed DSN into the row in place, hovering the revealed value reads the
 * full DSN in a tooltip, and copy (whole-row click or the button) runs the
 * injected on-demand fetch — the row never renders the DB Connection
 * Template.
 */
export function DatabaseConnectionRow({
  className,
  connection,
  label = connection.label,
  onCopy,
  onToggleReveal,
  publicAccessEnabled,
  publicSwitch,
  revealedValue,
  rowKey,
  variant = "node",
}: DatabaseConnectionRowProps) {
  const styles = ROW_VARIANT_CLASSES[variant];
  const publicEnabled =
    connection.kind === "public"
      ? (publicAccessEnabled ?? connection.publicAccess.enabled)
      : true;
  const valueKind = databaseConnectionRowValueKind(connection, publicEnabled);
  const copyable = valueKind?.kind === "secret";

  return (
    <CanvasNodeCopyableRow
      className={cn(
        "database-connection-row relative flex min-w-0 flex-col gap-2 rounded-lg transition-colors",
        styles.row,
        valueKind ? styles.rowWithValue : styles.rowWithoutValue,
        className
      )}
      copyAriaLabel={`Copy ${label}`}
      copyable={copyable}
      copyValue={connection.value}
      data-slot="database-connection-row"
      onCopy={onCopy ? () => onCopy() : undefined}
      rowKey={rowKey}
      // Suppress the hit-area's native tooltip: it would fall back to the
      // copy value, and the DB Connection Template must never reach the
      // screen (ADR-0054). The revealed-value tooltip is the reading surface.
      title=""
    >
      {({ copied, copyable: rowCopyable }) => (
        <>
          <div
            className={cn(
              "relative z-10 flex min-w-0 items-center justify-between gap-2",
              rowCopyable ? "pointer-events-none" : "pointer-events-auto"
            )}
          >
            <span
              className={cn(
                "min-w-0 truncate font-normal text-muted-foreground",
                styles.label
              )}
            >
              {label}
            </span>
            {publicSwitch ? (
              <CanvasNodeCopyableRowControl className="pointer-events-auto relative z-20 flex shrink-0 items-center">
                {publicSwitch}
              </CanvasNodeCopyableRowControl>
            ) : null}
          </div>
          {valueKind == null ? null : (
            <DatabaseConnectionRowValueLine
              copied={copied}
              label={label}
              onToggleReveal={onToggleReveal}
              revealedValue={revealedValue}
              rowCopyable={rowCopyable}
              styles={styles}
              valueKind={valueKind}
            />
          )}
        </>
      )}
    </CanvasNodeCopyableRow>
  );
}

function DatabaseConnectionRowValueLine({
  copied,
  label,
  onToggleReveal,
  revealedValue,
  rowCopyable,
  styles,
  valueKind,
}: {
  copied: boolean;
  label: string;
  onToggleReveal?: () => Promise<void> | void;
  revealedValue?: string;
  rowCopyable: boolean;
  styles: DatabaseConnectionRowStyles;
  valueKind: NonNullable<DatabaseConnectionRowValueKind>;
}) {
  const revealed = revealedValue !== undefined;
  const { copyRow } = useCanvasNodeCopyableRow();
  const handleCopyClick = () => {
    copyRow().catch(() => undefined);
  };

  return (
    <div
      className={cn(
        "relative z-10 flex min-w-0 items-center justify-between gap-2 py-1.5 text-left font-normal",
        styles.valueLine,
        rowCopyable
          ? cn("pointer-events-none", styles.valueText)
          : "pointer-events-auto text-muted-foreground"
      )}
      data-copied={copied ? "true" : undefined}
      data-revealed={revealed ? "true" : undefined}
      data-slot="database-connection-value"
    >
      {valueKind.kind === "secret" ? (
        <>
          <DatabaseConnectionRowSecretValue
            onCopyClick={handleCopyClick}
            revealedValue={revealedValue}
          />
          <CanvasNodeCopyableRowControl
            className={cn(
              "pointer-events-auto relative z-20 flex shrink-0 items-center gap-0.5 transition-opacity",
              // Progressive disclosure: controls surface on row hover/focus.
              // Pinned while revealed (the closed eye is the only early-hide
              // affordance for the on-screen DSN) and during copy feedback.
              revealed || copied
                ? "opacity-100"
                : "opacity-0 group-focus-within/copyable-row:opacity-100 group-hover/copyable-row:opacity-100"
            )}
          >
            {onToggleReveal ? (
              <AppIconButton
                aria-label={`${revealed ? "Hide" : "Reveal"} ${label}`}
                aria-pressed={revealed}
                className="text-muted-foreground hover:text-foreground"
                data-slot="database-connection-reveal-button"
                onClick={() => {
                  Promise.resolve(onToggleReveal()).catch(() => undefined);
                }}
                size="sm"
                type="button"
                variant="quiet"
              >
                {revealed ? (
                  <EyeClosed aria-hidden className="size-4" />
                ) : (
                  <Eye aria-hidden className="size-4" />
                )}
              </AppIconButton>
            ) : null}
            <AppIconButton
              aria-label={`${copied ? "Copied" : "Copy"} ${label}`}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                copied && "text-foreground"
              )}
              data-slot="database-connection-copy-button"
              onClick={handleCopyClick}
              size="sm"
              type="button"
              variant="quiet"
            >
              {copied ? (
                <Check aria-hidden className="size-4" />
              ) : (
                <Copy aria-hidden className="size-4" />
              )}
            </AppIconButton>
          </CanvasNodeCopyableRowControl>
        </>
      ) : (
        <span className="min-w-0 truncate" title={valueKind.text}>
          {valueKind.text}
        </span>
      )}
    </div>
  );
}

function DatabaseConnectionRowSecretValue({
  onCopyClick,
  revealedValue,
}: {
  onCopyClick: () => void;
  revealedValue?: string;
}) {
  if (revealedValue === undefined) {
    return (
      <span aria-hidden className="min-w-0 flex-1 truncate">
        {MASKED_SECRET_VALUE}
      </span>
    );
  }

  // The revealed value takes pointer events for the tooltip, so it is a real
  // button forwarding clicks to keep whole-row copy true; keyboard copy stays
  // on the row hit-area and the explicit copy button.
  return (
    <Tooltip>
      <TooltipTrigger
        className="nodrag nopan pointer-events-auto min-w-0 flex-1 cursor-pointer truncate text-left"
        onClick={onCopyClick}
        tabIndex={-1}
        type="button"
      >
        {revealedValue}
      </TooltipTrigger>
      <TooltipContent>{revealedValue}</TooltipContent>
    </Tooltip>
  );
}
