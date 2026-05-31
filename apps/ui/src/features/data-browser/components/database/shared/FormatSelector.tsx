import { cn } from "@data-browser/lib/utils";
import type { LucideIcon } from "lucide-react";

/** Describes a single format option for the selector grid. */
export interface FormatOption<T extends string = string> {
  icon: LucideIcon;
  id: T;
  label: string;
}

interface FormatSelectorProps<T extends string = string> {
  /** Disables all options (e.g., during export). */
  disabled?: boolean;
  /** Called when user picks a different format. */
  onChange: (value: T) => void;
  /** Available format choices. */
  options: FormatOption<T>[];
  /** Currently selected format. */
  value: T;
}

/** Grid of selectable format cards. Columns auto-adjust: 2 for ≤2 options, 4 otherwise. */
export function FormatSelector<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: FormatSelectorProps<T>) {
  return (
    <div className="flex flex-col gap-2">
      <label className="font-medium text-foreground text-sm">{"Format"}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
              value === option.id
                ? "border-transparent bg-blue-500/10 text-foreground"
                : "border-input bg-background text-foreground hover:bg-muted/30"
            )}
            disabled={disabled}
            key={option.id}
            onClick={() => onChange(option.id)}
            type="button"
          >
            <option.icon
              className={cn(
                "h-4 w-4",
                value === option.id
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            />
            <span className="font-normal text-sm">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
