"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { Check, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/features/deploy/deployment-task-success-confetti";
import type {
  DeploymentTaskSuccessEntry,
  DeploymentTaskSuccessSnapshot,
} from "@/features/deploy/task/timeline";
import { useCopyFeedback } from "@/features/deploy/use-copy-feedback";

/**
 * The result half of the Deployment Timeline (issue #160).
 *
 * It renders what the runner *proved* — Result Readiness plus every required
 * entry probe — and nothing else: an absent address stays absent, an absent
 * first-use guide stays absent, and the UI never builds an endpoint out of a
 * host and a port. The process half lives in the Timeline pane; this module is
 * the answer the user came for, so the arrival (scroll into view) belongs here.
 */

const TASK_RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

/** Units coarser than a minute, largest first; seconds are the fallback. */
const TASK_RELATIVE_TIME_UNITS: ReadonlyArray<
  readonly [Intl.RelativeTimeFormatUnit, number]
> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * Compact freshness for the verification line ("verified 3 min ago"). The
 * absolute instant stays available as the row's `title`, because a relative
 * label alone goes stale the moment the stream stops ticking.
 */
function formatTaskRelativeTime(value: string, now: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  const deltaSeconds = Math.round((timestamp - now) / 1000);
  if (Math.abs(deltaSeconds) < 45) {
    return TASK_RELATIVE_TIME_FORMAT.format(deltaSeconds, "second");
  }
  for (const [unit, unitSeconds] of TASK_RELATIVE_TIME_UNITS) {
    if (Math.abs(deltaSeconds) >= unitSeconds) {
      return TASK_RELATIVE_TIME_FORMAT.format(
        Math.round(deltaSeconds / unitSeconds),
        unit
      );
    }
  }
  return TASK_RELATIVE_TIME_FORMAT.format(deltaSeconds, "second");
}

const SUCCESS_HEADLINE_FALLBACK = "You can start using it";
const SUCCESS_OPEN_LABEL_FALLBACK = "Open";
/** How often the freshness label is allowed to age while the card sits open. */
const SUCCESS_FRESHNESS_REFRESH_MS = 30_000;

function isOpenableEntry(entry: DeploymentTaskSuccessEntry): boolean {
  if (entry.protocol != null) {
    return entry.protocol === "http" || entry.protocol === "https";
  }
  try {
    const protocol = new URL(entry.url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function SuccessEntryRow({ entry }: { entry: DeploymentTaskSuccessEntry }) {
  const [copied, copyEntry] = useCopyFeedback(entry.url);

  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-input/30 px-3 py-2 transition-colors hover:bg-input"
      data-slot="deployment-task-success-entry"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {entry.label == null ? null : (
          <span
            className="truncate text-muted-foreground text-xs leading-4"
            title={entry.label}
          >
            {entry.label}
          </span>
        )}
        <span
          className="truncate font-mono text-foreground text-xs leading-4"
          title={entry.url}
        >
          {entry.url}
        </span>
      </div>
      <AppIconButton
        aria-label={copied ? "Address copied" : "Copy address"}
        onClick={copyEntry}
        size="sm"
        variant="quiet"
      >
        {copied ? (
          <Check aria-hidden className="size-3.5" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
      </AppIconButton>
    </div>
  );
}

/**
 * The verified-usable conclusion, appended after the Timeline's own steps
 * (issue #160). It exists only when Result Readiness was reached AND every
 * required entry probe passed, so nothing here re-derives success from the
 * task status: absent fields stay absent, and an address is only ever the one
 * the contract declared — the UI never builds one from a host or a port.
 */
export const DeploymentTaskSuccessSection = memo(
  function DeploymentTaskSuccessSection({
    success,
  }: {
    success: DeploymentTaskSuccessSnapshot;
  }) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const seenRevisionRef = useRef<number | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const entries = success.entries ?? [];
    const guidance = success.guidance ?? [];
    const primaryEntry = entries.find(isOpenableEntry);
    const verification = success.verification;

    useEffect(() => {
      const timer = setInterval(() => {
        setNow(Date.now());
      }, SUCCESS_FRESHNESS_REFRESH_MS);
      return () => {
        clearInterval(timer);
      };
    }, []);

    // Bring the result into view when it lands: the steps above are the
    // process, this is the answer. `block: "nearest"` keeps the jump minimal
    // when the card is already partly visible, and reduced motion gets an
    // instant scroll instead of an animation nobody asked for.
    useEffect(() => {
      const previousRevision = seenRevisionRef.current;
      seenRevisionRef.current = success.revision;
      if (previousRevision === success.revision) {
        return;
      }
      rootRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "nearest",
      });
    }, [success.revision]);

    return (
      <div
        className="relative mt-4 flex flex-col gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4"
        data-slot="deployment-task-success"
        ref={rootRef}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <CheckCircle2
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-emerald-500"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="break-words font-medium text-foreground text-sm leading-5">
                {success.headline ?? SUCCESS_HEADLINE_FALLBACK}
              </p>
              {success.productName == null ? null : (
                <p
                  className="truncate text-muted-foreground text-xs leading-4"
                  title={success.productName}
                >
                  {success.productName}
                </p>
              )}
            </div>
          </div>
          {primaryEntry == null ? null : (
            <AppButton
              className="shrink-0"
              nativeButton={false}
              render={
                <a
                  href={primaryEntry.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ExternalLink aria-hidden data-icon="inline-start" />
                  {success.openActionLabel ?? SUCCESS_OPEN_LABEL_FALLBACK}
                </a>
              }
              size="sm"
            />
          )}
        </div>
        {guidance.length === 0 ? null : (
          <ol className="flex flex-col gap-1.5">
            {guidance.map((step, index) => (
              <li
                className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-1 text-xs leading-4"
                key={[index, step.label].join("-")}
              >
                <span
                  aria-hidden
                  className="text-muted-foreground tabular-nums"
                >
                  {index + 1}.
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words text-foreground/90 leading-4">
                    {step.label}
                  </span>
                  {step.detail == null ? null : (
                    <span className="break-words font-mono text-muted-foreground text-xs leading-4">
                      {step.detail}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {entries.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            {entries.map((entry, index) => (
              <SuccessEntryRow
                entry={entry}
                key={[index, entry.url].join("-")}
              />
            ))}
          </div>
        )}
        {verification == null ? null : (
          <p
            className="text-muted-foreground text-xs leading-4"
            data-slot="deployment-task-success-verification"
            title={success.verifiedAt}
          >
            {verification.passed}/{verification.total} checks passed
            {" \u00b7 "}
            verified {formatTaskRelativeTime(success.verifiedAt, now)}
            <span className="sr-only"> at {success.verifiedAt}</span>
          </p>
        )}
      </div>
    );
  }
);
