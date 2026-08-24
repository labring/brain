"use client";

import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";
import { validateResourceDisplayNameRename } from "@/features/resource-display-name/resource-display-name";

const RENAME_ERROR_COPY = {
  duplicate: "Another resource in this project already has this name.",
  failed: "Could not rename the resource. Try again.",
  "too-long": "Names can be at most 256 characters.",
} as const;

/**
 * Settings pane title as the rename surface (ADR 0062): click the Resource
 * Display Name to edit it in place. Submitting an empty title clears the
 * annotation and restores the Kubernetes name; a duplicate within the
 * Project is rejected with the reason shown inline. Thin shell over the
 * resource-display-name module — the rules live there.
 */
export function ResourceDisplayNameTitle({
  displayName,
  onRename,
  takenNames,
}: {
  displayName: string;
  onRename?: (value: string | null) => Promise<void>;
  takenNames: readonly string[];
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<keyof typeof RENAME_ERROR_COPY | null>(
    null
  );
  const [saving, setSaving] = useState(false);

  if (onRename == null) {
    return (
      <h2
        className="truncate font-semibold text-foreground text-lg leading-none"
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
    if (result.kind === "set" && result.value === displayName) {
      cancelEditing();
      return;
    }
    setSaving(true);
    try {
      await onRename(result.kind === "clear" ? null : result.value);
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
        className="-mx-1 min-w-0 truncate rounded-sm px-1 text-left font-semibold text-foreground text-lg leading-none hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={beginEditing}
        title={`${displayName} — click to rename`}
        type="button"
      >
        {displayName}
      </button>
    );
  }

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <input
        aria-invalid={error != null}
        aria-label="Resource display name"
        autoFocus
        className={cn(
          "-mx-1 w-full min-w-0 rounded-sm border border-input bg-transparent px-1 font-semibold text-foreground text-lg leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
          error != null && "border-destructive"
        )}
        disabled={saving}
        onBlur={() => {
          submit().catch(() => undefined);
        }}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit().catch(() => undefined);
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing();
          }
        }}
        placeholder={displayName}
        value={value}
      />
      {error == null ? null : (
        <p className="text-destructive text-xs leading-4" role="alert">
          {RENAME_ERROR_COPY[error]}
        </p>
      )}
    </span>
  );
}
