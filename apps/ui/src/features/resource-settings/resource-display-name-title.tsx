"use client";

import { Spinner } from "@workspace/ui/components/spinner";
import {
  appFieldFocusClass,
  appFieldInvalidClass,
} from "@workspace/ui/lib/field-state";
import { cn } from "@workspace/ui/lib/utils";
import { SquarePen } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { validateResourceDisplayNameRename } from "@/features/resource-display-name/resource-display-name";

const RENAME_ERROR_COPY = {
  duplicate: "Another resource in this project already has this name.",
  failed: "Could not rename the resource. Try again.",
  "too-long": "Names can be at most 256 characters.",
} as const;

/**
 * Settings pane title as the rename surface (ADR 0066): hovering or focusing
 * the title reveals an edit affordance, and clicking it (or the title) opens
 * an inline editor. Enter and focus leaving the editor both commit; Escape
 * reverts. An empty or unchanged value commits as a no-op. While a save is in
 * flight the editor shows the draft, disabled, with a spinner. An invalid
 * value keeps the editor open with an inline error when it came from Enter,
 * and reverts with a toast when it came from leaving the editor — the name
 * never changed, so the reverted title is the truth. A failed save always
 * keeps the editor open with the draft and an inline error, so it stays
 * unambiguous what the name currently is. Thin shell over the
 * resource-display-name module — the rules live there.
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
  // Disabling the input mid-save can fire a browser blur before the `saving`
  // state reaches the handler's closure — the ref is the authoritative guard.
  const savingRef = useRef(false);

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

  const closeEditor = () => {
    setEditing(false);
    setError(null);
  };

  const submit = async (source: "enter" | "leave") => {
    if (savingRef.current) {
      return;
    }
    const result = validateResourceDisplayNameRename({ takenNames, value });
    if (result.kind === "invalid") {
      if (source === "leave") {
        toast.error(RENAME_ERROR_COPY[result.reason]);
        closeEditor();
        return;
      }
      setError(result.reason);
      return;
    }
    if (result.kind === "noop" || result.value === displayName) {
      closeEditor();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onRename(result.value);
      closeEditor();
    } catch {
      setError("failed");
    } finally {
      savingRef.current = false;
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

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <input
          aria-invalid={error != null}
          aria-label="Resource display name"
          autoFocus
          className={cn(
            // field-sizing-content: the editor hugs the draft text like the
            // title it replaces; an empty value sizes to the placeholder.
            // While saving (the only disabled state) the box dissolves into
            // plain dimmed title text — the border transparent, not removed,
            // so the text does not shift.
            "field-sizing-content -ml-1 h-7 min-w-24 max-w-full rounded-sm border border-input bg-transparent px-1 font-semibold text-base text-foreground leading-none outline-none disabled:border-transparent disabled:opacity-60",
            appFieldFocusClass,
            appFieldInvalidClass
          )}
          disabled={saving}
          onBlur={() => {
            submit("leave").catch(() => undefined);
          }}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          // Select-all on entry: replacing wholesale is the common case, and
          // a cursor parked at the end scrolls a long name's start out of view.
          onFocus={(event) => {
            event.currentTarget.select();
            event.currentTarget.scrollLeft = 0;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit("enter").catch(() => undefined);
              return;
            }
            if (event.key === "Escape" && !saving) {
              event.preventDefault();
              closeEditor();
            }
          }}
          placeholder={displayName}
          value={value}
        />
        {saving ? (
          <Spinner
            aria-label="Saving name"
            className="shrink-0 text-muted-foreground"
          />
        ) : null}
      </span>
      {error == null ? null : (
        <p className="text-destructive text-xs leading-4" role="alert">
          {RENAME_ERROR_COPY[error]}
        </p>
      )}
    </span>
  );
}
