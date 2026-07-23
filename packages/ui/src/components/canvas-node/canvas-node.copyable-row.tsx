"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import {
  type ComponentPropsWithoutRef,
  createContext,
  type ReactNode,
  type SyntheticEvent,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const CANVAS_NODE_DEFAULT_COPIED_FEEDBACK_MS = 1200;

export type CanvasNodeCopyableRowKey = string;

export interface CanvasNodeCopyFeedbackValue {
  copiedFeedbackMs: number;
  copiedKey: CanvasNodeCopyableRowKey | null;
  showCopiedFeedback: (key: CanvasNodeCopyableRowKey) => void;
}

export type CanvasNodeCopyFeedbackScopeChildren =
  | ReactNode
  | ((value: CanvasNodeCopyFeedbackValue) => ReactNode);

export interface CanvasNodeCopyFeedbackScopeProps {
  children?: CanvasNodeCopyFeedbackScopeChildren;
  copiedFeedbackMs?: number;
  copiedKey?: CanvasNodeCopyableRowKey | null;
}

export interface CanvasNodeCopyableRowState {
  copied: boolean;
  copyable: boolean;
  /**
   * Runs the row's copy action — the injected onCopy or the clipboard
   * fallback — followed by copied feedback, exactly like the row hit-area.
   * Lets custom controls inside the row copy without a second pipeline.
   */
  copyRow: () => Promise<void>;
}

type CanvasNodeCopyableRowChildren =
  | ReactNode
  | ((state: CanvasNodeCopyableRowState) => ReactNode);

export interface CanvasNodeCopyableRowProps
  extends Omit<ComponentPropsWithoutRef<"section">, "children" | "onCopy"> {
  children?: CanvasNodeCopyableRowChildren;
  copyAriaLabel: string;
  copyable?: boolean;
  copyValue?: string;
  onCopy?: (
    value: string,
    key: CanvasNodeCopyableRowKey
  ) => Promise<void> | void;
  rowKey: CanvasNodeCopyableRowKey;
}

export type CanvasNodeCopyableRowControlProps =
  ComponentPropsWithoutRef<"span">;

export type CanvasNodeCopyableRowIndicatorProps =
  ComponentPropsWithoutRef<"span">;

const CanvasNodeCopyFeedbackContext =
  createContext<CanvasNodeCopyFeedbackValue | null>(null);

const CanvasNodeCopyableRowContext =
  createContext<CanvasNodeCopyableRowState | null>(null);

async function copyTextToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }

  await navigator.clipboard.writeText(value);
}

function stopCanvasNodeControlEvent(event: SyntheticEvent) {
  event.stopPropagation();
}

function composeStopPropagationHandler<Event extends SyntheticEvent>(
  handler: ((event: Event) => void) | undefined
) {
  return (event: Event) => {
    handler?.(event);
    stopCanvasNodeControlEvent(event);
  };
}

function CanvasNodeCopyFeedbackChildren({
  children,
}: {
  children?: CanvasNodeCopyFeedbackScopeChildren;
}) {
  const value = useCanvasNodeCopyFeedback();

  if (typeof children === "function") {
    return children(value);
  }

  return children;
}

function renderCopyableRowChildren(
  children: CanvasNodeCopyableRowChildren | undefined,
  state: CanvasNodeCopyableRowState
) {
  if (typeof children === "function") {
    return children(state);
  }

  return children;
}

export function CanvasNodeCopyFeedbackScope({
  children,
  copiedFeedbackMs = CANVAS_NODE_DEFAULT_COPIED_FEEDBACK_MS,
  copiedKey,
}: CanvasNodeCopyFeedbackScopeProps) {
  const [internalCopiedKey, setInternalCopiedKey] =
    useState<CanvasNodeCopyableRowKey | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedKeyControlled = copiedKey !== undefined;
  const resolvedCopiedKey = copiedKeyControlled ? copiedKey : internalCopiedKey;

  useEffect(
    () => () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  const showCopiedFeedback = useCallback(
    (nextCopiedKey: CanvasNodeCopyableRowKey) => {
      if (copiedKeyControlled) {
        return;
      }

      setInternalCopiedKey(nextCopiedKey);

      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }

      resetTimerRef.current = setTimeout(() => {
        setInternalCopiedKey(null);
        resetTimerRef.current = null;
      }, copiedFeedbackMs);
    },
    [copiedFeedbackMs, copiedKeyControlled]
  );

  const value = useMemo(
    (): CanvasNodeCopyFeedbackValue => ({
      copiedFeedbackMs,
      copiedKey: resolvedCopiedKey ?? null,
      showCopiedFeedback,
    }),
    [copiedFeedbackMs, resolvedCopiedKey, showCopiedFeedback]
  );

  return (
    <CanvasNodeCopyFeedbackContext value={value}>
      <CanvasNodeCopyFeedbackChildren>
        {children}
      </CanvasNodeCopyFeedbackChildren>
    </CanvasNodeCopyFeedbackContext>
  );
}

export function useCanvasNodeCopyFeedback(): CanvasNodeCopyFeedbackValue {
  const value = use(CanvasNodeCopyFeedbackContext);

  if (!value) {
    throw new Error(
      "CanvasNode.CopyableRow must be used within CanvasNode.CopyFeedbackScope"
    );
  }

  return value;
}

export function useCanvasNodeCopyableRow(): CanvasNodeCopyableRowState {
  const value = use(CanvasNodeCopyableRowContext);

  if (!value) {
    throw new Error(
      "CanvasNode.CopyableRowIndicator must be used within CanvasNode.CopyableRow"
    );
  }

  return value;
}

export function CanvasNodeCopyableRow({
  children,
  className,
  copyAriaLabel,
  copyValue,
  copyable,
  onCopy,
  rowKey,
  title,
  ...props
}: CanvasNodeCopyableRowProps) {
  const { copiedKey, showCopiedFeedback } = useCanvasNodeCopyFeedback();
  const hasCopyValue = typeof copyValue === "string" && copyValue.length > 0;
  const resolvedCopyable = (copyable ?? hasCopyValue) && hasCopyValue;

  const copyRow = useCallback(async () => {
    if (!(resolvedCopyable && copyValue)) {
      return;
    }

    // Feedback follows the copy: an onCopy handler may fetch the real value
    // on demand, and a rejected copy must not read as "copied".
    if (onCopy) {
      await onCopy(copyValue, rowKey);
    } else {
      await copyTextToClipboard(copyValue);
    }
    showCopiedFeedback(rowKey);
  }, [copyValue, onCopy, resolvedCopyable, rowKey, showCopiedFeedback]);

  const state = useMemo(
    (): CanvasNodeCopyableRowState => ({
      copied: copiedKey === rowKey,
      copyable: resolvedCopyable,
      copyRow,
    }),
    [copiedKey, copyRow, resolvedCopyable, rowKey]
  );

  return (
    <CanvasNodeCopyableRowContext value={state}>
      <section
        className={cn(
          "group/copyable-row canvas-node-copyable-row",
          !resolvedCopyable && "canvas-node-copyable-row-static",
          className
        )}
        data-copied={state.copied ? "true" : undefined}
        data-copyable={resolvedCopyable || undefined}
        data-slot="canvas-node-copyable-row"
        {...props}
      >
        {resolvedCopyable ? (
          <button
            aria-label={copyAriaLabel}
            className="nodrag nopan canvas-node-copyable-row-hitarea absolute inset-0 z-0 cursor-pointer rounded-lg focus-visible:outline-none"
            data-slot="canvas-node-copyable-row-hitarea"
            onClick={(event) => {
              event.stopPropagation();
              copyRow().catch(() => undefined);
            }}
            onDoubleClick={stopCanvasNodeControlEvent}
            onKeyDown={stopCanvasNodeControlEvent}
            onPointerDown={stopCanvasNodeControlEvent}
            title={title ?? copyValue}
            type="button"
          />
        ) : null}
        {renderCopyableRowChildren(children, state)}
      </section>
    </CanvasNodeCopyableRowContext>
  );
}

export function CanvasNodeCopyableRowControl({
  children,
  className,
  onClick,
  onDoubleClick,
  onKeyDown,
  onPointerDown,
  ...props
}: CanvasNodeCopyableRowControlProps) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: wrapper isolates nested controls from React Flow drag and pan events.
    // biome-ignore lint/a11y/noStaticElementInteractions: interaction remains on nested controls; this span only stops propagation.
    <span
      className={cn("nodrag nopan", className)}
      onClick={composeStopPropagationHandler(onClick)}
      onDoubleClick={composeStopPropagationHandler(onDoubleClick)}
      onKeyDown={composeStopPropagationHandler(onKeyDown)}
      onPointerDown={composeStopPropagationHandler(onPointerDown)}
      {...props}
    >
      {children}
    </span>
  );
}

export function CanvasNodeCopyableRowIndicator({
  className,
  ...props
}: CanvasNodeCopyableRowIndicatorProps) {
  const { copied, copyable } = useCanvasNodeCopyableRow();

  if (!copyable) {
    return null;
  }

  if (copied) {
    return (
      <span
        className={cn("size-4 shrink-0", className)}
        key="copied"
        {...props}
      >
        <Check aria-hidden className="size-4" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "canvas-node-copyable-row-copy-icon size-4 shrink-0 opacity-0 transition-opacity group-hover/copyable-row:opacity-100",
        className
      )}
      key="copy"
      {...props}
    >
      <Copy aria-hidden className="size-4" />
    </span>
  );
}
