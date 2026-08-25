"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  appFieldFocusClass,
  appFieldInvalidClass,
} from "@workspace/ui/lib/field-state";
import { cn } from "@workspace/ui/lib/utils";
import { Check, SquarePen, X } from "lucide-react";
import { type FocusEvent, type KeyboardEvent, useRef, useState } from "react";
import { validateResourceDisplayNameRename } from "@/features/resource-display-name/resource-display-name";

const RENAME_ERROR_COPY = {
  duplicate: "Another resource in this project already has this name.",
  failed: "Could not rename the resource. Try again.",
  "too-long": "Names can be at most 256 characters.",
} as const;

/**
 * Settings pane title as the rename surface (ADR 0066): hovering or focusing
 * the title reveals an edit affordance, and clicking it (or the title) opens
 * an inline editor with explicit confirm/cancel buttons. Saving is always an
 * explicit act — Enter or the check button; Escape, the cross button, or
 * focus leaving the editor discards the draft. An empty or unchanged value
 * confirms as a no-op. Thin shell over the resource-display-name module —
 * the rules live there.
 */
export function ResourceDisplayNameTitle({
  displayName,
  onRename,
  takenNames,
}: {
  displayName: string;
  onRename?: (value: string) => Promise<void>;
  takenNames: readonly string[];
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<keyof typeof RENAME_ERROR_COPY | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLSpanElement>(null);

  if (onRename == null) {
    return (
      <h2
        className="truncate font-semibold text-base text-foreground leading-none"
        title={displayName}
      >
        {displayName}
      </h2>
    );
  }

  const beginEditing = () => {
    setValue(displayName);
    setError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setError(null);
  };

  const submit = async () => {
    if (saving) {
      return;
    }
    const result = validateResourceDisplayNameRename({ takenNames, value });
    if (result.kind === "invalid") {
      setError(result.reason);
      return;
    }
    if (result.kind === "noop" || result.value === displayName) {
      cancelEditing();
      return;
    }
    setSaving(true);
    try {
      await onRename(result.value);
      setEditing(false);
      setError(null);
    } catch {
      setError("failed");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        aria-label={`Rename ${displayName}`}
        className="group -mx-2 flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-left font-semibold text-base text-foreground leading-none transition-colors hover:bg-input/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={beginEditing}
        title={`${displayName} — click to rename`}
        type="button"
      >
        <span className="min-w-0 truncate">{displayName}</span>
        <SquarePen
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </button>
    );
  }

  // Focus moving within the editor (input ↔ buttons) is not a leave; a save
  // in flight must not be torn down by the input disabling.
  const leaveEditor = (event: FocusEvent) => {
    if (saving) {
      return;
    }
    if (editorRef.current?.contains(event.relatedTarget as Node | null)) {
      return;
    }
    cancelEditing();
  };

  const escapeEditor = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !saving) {
      event.preventDefault();
      cancelEditing();
    }
  };

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1" ref={editorRef}>
      <span className="flex min-w-0 items-center gap-1.5">
        <input
          aria-invalid={error != null}
          aria-label="Resource display name"
          autoFocus
          className={cn(
            "-ml-1 h-7 w-full min-w-0 max-w-48 rounded-sm border border-input bg-transparent px-1 font-semibold text-base text-foreground leading-none outline-none",
            appFieldFocusClass,
            appFieldInvalidClass
          )}
          disabled={saving}
          onBlur={leaveEditor}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit().catch(() => undefined);
              return;
            }
            escapeEditor(event);
          }}
          placeholder={displayName}
          value={value}
        />
        <AppIconButton
          aria-label="Save name"
          busy={saving}
          className="shrink-0 hover:text-brand-primary-foreground"
          onBlur={leaveEditor}
          onClick={() => {
            submit().catch(() => undefined);
          }}
          onKeyDown={escapeEditor}
          onMouseDown={(event) => {
            // Keep the input focused so the click lands before any blur.
            event.preventDefault();
          }}
          size="sm"
          variant="quiet"
        >
          <Check />
        </AppIconButton>
        <AppIconButton
          aria-label="Cancel rename"
          className="shrink-0 hover:text-brand-primary-foreground"
          disabled={saving}
          onBlur={leaveEditor}
          onClick={cancelEditing}
          onKeyDown={escapeEditor}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          size="sm"
          variant="quiet"
        >
          <X />
        </AppIconButton>
      </span>
      {error == null ? null : (
        <p className="text-destructive text-xs leading-4" role="alert">
          {RENAME_ERROR_COPY[error]}
        </p>
      )}
    </span>
  );
}
