"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { Gift } from "lucide-react";

import type { FreeChatTurnsUsage } from "@/features/chat/persistence/client";

const EXPIRY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatFreePlanExpiry(iso: string): string | null {
  if (iso.trim() === "") {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : EXPIRY_FORMATTER.format(date);
}

/**
 * The Plan view's "Free trial messages" allowance card (ADR-0065, AIM-298
 * confirmed prototype). Rendered in the credits slot under exactly the
 * Active Free Trial predicate; after upgrade the AI Credits section takes
 * its place. Usage comes from Brain's own chat session system — never
 * account-service — so its failure degrades quietly instead of reading as a
 * billing problem. Vocabulary red line: never "AI Credits", never "trial
 * credits".
 */
export function BillingFreeTurnsSection({
  expiresAt,
  usage,
  usageUnavailable,
}: {
  /** Free Plan Expiry (subscription period end), ISO string; empty hides the date. */
  expiresAt: string;
  /** `null` while loading (when `usageUnavailable` is false). */
  usage: FreeChatTurnsUsage | null;
  usageUnavailable: boolean;
}) {
  const expiry = formatFreePlanExpiry(expiresAt);
  const exhausted = usage != null && usage.remaining === 0;
  const usedPercent =
    usage == null || usage.limit === 0
      ? 0
      : Math.min(100, Math.max(0, (usage.used / usage.limit) * 100));

  return (
    <section
      aria-live="polite"
      className="flex flex-col gap-4 rounded-lg bg-input/30 p-4 sm:flex-row sm:items-center sm:justify-between"
      data-slot="billing-free-turns-section"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-input/40 text-muted-foreground">
          <Gift aria-hidden className="size-4.5" strokeWidth={1.75} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-medium text-foreground text-sm">
            Free trial messages
          </h2>
          {usageUnavailable ? (
            <p className="text-muted-foreground text-sm" role="status">
              Usage is unavailable right now — your free trial messages still
              work.
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              Included with the Free plan
              {expiry == null ? "" : ` · until ${expiry}`}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        {usage == null && !usageUnavailable ? (
          <Skeleton
            aria-label="Loading free trial messages"
            className="h-5 w-28"
          />
        ) : null}
        {usage == null ? null : (
          <div className="flex items-center gap-3">
            <div
              aria-label="Free trial messages used"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={usedPercent}
              aria-valuetext={`${usage.remaining} of ${usage.limit} left`}
              className="h-2 w-32 overflow-hidden rounded-full bg-input"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-linear-to-r from-blue-950 to-blue-500"
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <span className="whitespace-nowrap font-medium text-foreground text-sm tabular-nums">
              {exhausted
                ? `All ${usage.limit} used`
                : `${usage.remaining} of ${usage.limit} left`}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
