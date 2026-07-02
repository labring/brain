import { Gift } from "lucide-react";

export interface FreeTurnsIndicatorProps {
  limit: number;
  remaining: number;
}

/**
 * Remaining Free Chat Turns for the current namespace, shown in the Project
 * Assistant Pane only while Chat Billing Mode is `free`. Steady-state `user`
 * billing is surfaced by nothing at all — see ADR 0033. Deliberately not a
 * `Chat.*` primitive: billing presentation stays app-local.
 */
export function FreeTurnsIndicator({
  remaining,
  limit,
}: FreeTurnsIndicatorProps) {
  return (
    <div
      className="flex w-fit items-center gap-1.5 px-1 text-muted-foreground text-xs"
      data-slot="free-turns-indicator"
      title={`${remaining} of ${limit} free assistant turns remaining`}
    >
      <Gift aria-hidden className="size-3.5 shrink-0" />
      <span>
        Free{" "}
        <span className="font-medium text-foreground">
          {remaining}/{limit}
        </span>
      </span>
    </div>
  );
}
