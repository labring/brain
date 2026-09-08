"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import { Check, Copy, ExternalLink } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/features/deploy/deployment-task-success-confetti";
import { DeploymentTaskSuccessShareStrip } from "@/features/deploy/deployment-task-success-share";
import type {
  DeploymentTaskSuccessEntry,
  DeploymentTaskSuccessSnapshot,
  DeploymentTaskSuccessStep,
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

const SUCCESS_HEADLINE_FALLBACK = "You can start using it";
const SUCCESS_OPEN_LABEL_FALLBACK = "Open";

/** Entrance: each block rises in on a short stagger once the record lands. */
const RISE_CLASS =
  "animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300 ease-out motion-reduce:animate-none";

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

/** The declared URL with its scheme muted; the text stays the whole address. */
function AddressText({ url }: { url: string }) {
  const index = url.indexOf("://");
  if (index === -1) {
    return url;
  }
  return (
    <>
      <span className="text-muted-foreground">{url.slice(0, index + 3)}</span>
      {url.slice(index + 3)}
    </>
  );
}

function DrawnCheck() {
  return (
    <svg
      aria-hidden
      className="size-10 text-blue-400"
      fill="none"
      viewBox="0 0 40 40"
    >
      <title>Verified</title>
      <circle
        className="deployment-success-draw-ring"
        cx="20"
        cy="20"
        pathLength={1}
        r="18"
        stroke="currentColor"
        strokeOpacity={0.35}
        strokeWidth="1.5"
      />
      <path
        className="deployment-success-draw-check"
        d="M12.5 20.5l5 5 10-10"
        pathLength={1}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}

/**
 * The primary address as a centered pill: its heading as a muted prefix
 * (when `headed`), the address itself, and a copy control; click anywhere to
 * copy.
 */
function PrimaryEntryChip({
  entry,
  headed,
}: {
  entry: DeploymentTaskSuccessEntry;
  headed: boolean;
}) {
  const [copied, copyEntry] = useCopyFeedback(entry.url);
  return (
    <button
      aria-label={copied ? "Address copied" : "Copy address"}
      className={cn(
        RISE_CLASS,
        "group/chip mt-3 inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-border bg-input/30 py-1 pr-2 pl-3 font-mono text-xs leading-4 outline-none transition-colors delay-200 hover:bg-input focus-visible:ring-2 focus-visible:ring-ring/30"
      )}
      data-slot="deployment-task-success-entry"
      onClick={copyEntry}
      title={entry.url}
      type="button"
    >
      <span className="truncate text-foreground">
        {headed && entry.label != null ? (
          <span className="text-muted-foreground">{entry.label} </span>
        ) : null}
        <AddressText url={entry.url} />
      </span>
      {copied ? (
        <Check aria-hidden className="size-3 shrink-0 text-blue-400" />
      ) : (
        <Copy
          aria-hidden
          className="size-3 shrink-0 text-muted-foreground transition-colors group-hover/chip:text-foreground"
        />
      )}
    </button>
  );
}

/** Every other verified address: a headed line with its own copy control. */
function SecondaryEntryRow({
  entry,
  headed,
}: {
  entry: DeploymentTaskSuccessEntry;
  headed: boolean;
}) {
  const [copied, copyEntry] = useCopyFeedback(entry.url);
  return (
    <div
      className="flex min-w-0 items-center gap-1 text-left"
      data-slot="deployment-task-success-entry"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {headed && entry.label != null ? (
          <span
            className="truncate text-[11px] text-muted-foreground leading-4"
            title={entry.label}
          >
            {entry.label}
          </span>
        ) : null}
        <span
          className="truncate font-mono text-foreground text-xs leading-4"
          title={entry.url}
        >
          <AddressText url={entry.url} />
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
 * The declared first-use steps as the Timeline's numbered trail: a numbered
 * circle per step, a hairline down to the next, the label and its optional
 * monospace detail. Rendered only when the record declared at least one step;
 * the sanitizer already caps the list, so the UI adds no cap of its own.
 */
function NextStepsTrail({ steps }: { steps: DeploymentTaskSuccessStep[] }) {
  const last = steps.length - 1;
  return (
    <ol className="mt-3 flex flex-col">
      {steps.map((step, index) => (
        <li
          className={cn("relative flex gap-3", index === last ? "" : "pb-4")}
          key={[index, step.label].join("-")}
        >
          {index === last ? null : (
            <span
              aria-hidden
              className="absolute top-6 bottom-0 left-2.5 w-px bg-border"
            />
          )}
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[11px] text-muted-foreground leading-none"
          >
            {index + 1}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
            <span className="break-words text-foreground text-xs leading-4">
              {step.label}
            </span>
            {step.detail == null ? null : (
              <span className="break-words font-mono text-[11px] text-muted-foreground leading-4">
                {step.detail}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The verified-usable conclusion, appended after the Timeline's own steps
 * (issue #160). It exists only when Result Readiness was reached AND every
 * required entry probe passed, so nothing here re-derives success from the
 * task status: absent fields stay absent, and an address is only ever the one
 * the contract declared — the UI never builds one from a host or a port.
 *
 * Shape: the card leads — the celebration (halo, drawn check, headline), the
 * primary address as a copy chip over one wide Open, every other verified
 * address in a quiet list beneath a hairline. Under the card sit a share strip
 * for the primary HTTP(S) entry (AIM-354) and the declared first-use steps as
 * a `Next steps` trail. The section owns the whole conclusion, so the arrival
 * (scroll into view) and the section slot belong to the wrapper, and the
 * Timeline pane keeps rendering one section (ADR-0078).
 */
export const DeploymentTaskSuccessSection = memo(
  function DeploymentTaskSuccessSection({
    success,
  }: {
    success: DeploymentTaskSuccessSnapshot;
  }) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const seenRevisionRef = useRef<number | null>(null);
    const entries = success.entries ?? [];
    const guidance = success.guidance ?? [];
    const primaryEntry = entries.find(isOpenableEntry);
    const secondaryEntries = entries.filter((entry) => entry !== primaryEntry);
    // A lone entry is headed by nothing, whatever heading its source gave it,
    // as the Public Access Node draws a lone Public Address (CONTEXT.md,
    // Deployment Task Success Record).
    const headed = entries.length > 1;
    const headline = success.headline ?? SUCCESS_HEADLINE_FALLBACK;
    const openLabel =
      success.openActionLabel ??
      (success.productName == null
        ? SUCCESS_OPEN_LABEL_FALLBACK
        : `${SUCCESS_OPEN_LABEL_FALLBACK} ${success.productName}`);

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
        className="mt-4 flex flex-col"
        data-slot="deployment-task-success"
        ref={rootRef}
      >
        <div className="relative flex flex-col items-center overflow-hidden rounded-lg border border-blue-400/20 px-4 pt-6 pb-4 text-center">
          <span
            aria-hidden
            className="deployment-success-halo fade-in pointer-events-none absolute inset-x-0 top-0 h-32 animate-in duration-500 motion-reduce:animate-none"
          />
          <DrawnCheck />
          <p
            className={cn(
              RISE_CLASS,
              "mt-3 font-semibold text-base text-foreground leading-6 delay-100"
            )}
          >
            {headline}
          </p>
          {success.productName == null ? null : (
            <p
              className={cn(
                RISE_CLASS,
                "mt-0.5 truncate text-muted-foreground text-xs leading-4 delay-150"
              )}
              title={success.productName}
            >
              {success.productName}
            </p>
          )}
          {primaryEntry == null ? null : (
            <>
              <PrimaryEntryChip entry={primaryEntry} headed={headed} />
              <div
                className={cn(RISE_CLASS, "mt-4 w-full delay-300")}
                data-slot="deployment-task-success-primary-action"
              >
                <AppButton
                  className="w-full"
                  nativeButton={false}
                  render={
                    <a
                      href={primaryEntry.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <ExternalLink aria-hidden data-icon="inline-start" />
                      {openLabel}
                    </a>
                  }
                />
              </div>
            </>
          )}
          {secondaryEntries.length === 0 ? null : (
            <div
              className={cn(
                RISE_CLASS,
                "mt-4 flex w-full flex-col gap-2 border-border border-t pt-3 delay-[360ms]"
              )}
            >
              {secondaryEntries.map((entry, index) => (
                <SecondaryEntryRow
                  entry={entry}
                  headed={headed}
                  key={[index, entry.url].join("-")}
                />
              ))}
            </div>
          )}
        </div>
        {primaryEntry == null ? null : (
          <DeploymentTaskSuccessShareStrip
            className={cn(RISE_CLASS, "mt-2 delay-[420ms]")}
            productName={success.productName}
            url={primaryEntry.url}
          />
        )}
        {guidance.length === 0 ? null : (
          <div
            className={cn(RISE_CLASS, "mt-5 text-left delay-[480ms]")}
            data-slot="deployment-task-success-next-steps"
          >
            <h4 className="font-medium text-foreground text-xs leading-4">
              Next steps
            </h4>
            <NextStepsTrail steps={guidance} />
          </div>
        )}
      </div>
    );
  }
);
