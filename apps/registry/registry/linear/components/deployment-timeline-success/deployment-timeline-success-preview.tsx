"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import { cn } from "@workspace/ui/lib/utils";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Rocket,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Entry {
  label: string;
  openable: boolean;
  url: string;
}

const PRODUCT_NAME = "AFFiNE";
const PRIMARY_ENTRY: Entry = {
  label: "Public domain",
  openable: true,
  url: "https://affine.demo.sealos.run",
};
const SECONDARY_ENTRIES: Entry[] = [
  {
    label: "Admin console",
    openable: true,
    url: "https://affine.demo.sealos.run/admin",
  },
  {
    label: "Sync (WebSocket)",
    openable: false,
    url: "wss://sync.affine.demo.sealos.run",
  },
];

const TIMELINE_STEPS = [
  "Prepare template",
  "Create resources",
  "Verify workload and public domain",
] as const;

/** Entrance: each block rises in on a short stagger once the record lands. */
const RISE_CLASS =
  "animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300 ease-out motion-reduce:animate-none";

function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) {
        window.clearTimeout(timer.current);
      }
    },
    []
  );
  const copy = useCallback(() => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timer.current != null) {
          window.clearTimeout(timer.current);
        }
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  }, [text]);
  return [copied, copy];
}

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

function PrimaryEntryChip({ entry }: { entry: Entry }) {
  const [copied, copy] = useCopy(entry.url);
  return (
    <button
      aria-label={copied ? "Address copied" : "Copy address"}
      className={cn(
        RISE_CLASS,
        "group/chip mt-3 inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-border bg-input/30 py-1 pr-2 pl-3 font-mono text-xs leading-4 outline-none transition-colors delay-200 hover:bg-input focus-visible:ring-2 focus-visible:ring-ring/30"
      )}
      data-slot="deployment-task-success-entry"
      onClick={copy}
      title={entry.url}
      type="button"
    >
      <span className="truncate text-foreground">
        <span className="text-muted-foreground">{entry.label} </span>
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

function SecondaryEntryRow({ entry }: { entry: Entry }) {
  const [copied, copy] = useCopy(entry.url);
  return (
    <div
      className="flex min-w-0 items-center gap-1 text-left"
      data-slot="deployment-task-success-entry"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] text-muted-foreground leading-4">
          {entry.label}
        </span>
        <span
          className="truncate font-mono text-foreground text-xs leading-4"
          title={entry.url}
        >
          <AddressText url={entry.url} />
        </span>
      </div>
      <AppIconButton
        aria-label={copied ? "Address copied" : "Copy address"}
        onClick={copy}
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

function SuccessRecord({ entries }: { entries: Entry[] }) {
  return (
    <div
      className="relative mt-4 flex flex-col items-center overflow-hidden rounded-lg border border-blue-400/20 px-4 pt-6 pb-4 text-center"
      data-slot="deployment-task-success"
    >
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
        You can start using it
      </p>
      <p
        className={cn(
          RISE_CLASS,
          "mt-0.5 truncate text-muted-foreground text-xs leading-4 delay-150"
        )}
      >
        {PRODUCT_NAME}
      </p>
      <PrimaryEntryChip entry={PRIMARY_ENTRY} />
      <div
        className={cn(RISE_CLASS, "mt-4 w-full delay-300")}
        data-slot="deployment-task-success-primary-action"
      >
        <AppButton
          className="w-full"
          nativeButton={false}
          render={
            <a
              href={PRIMARY_ENTRY.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLink aria-hidden data-icon="inline-start" />
              Open {PRODUCT_NAME}
            </a>
          }
        />
      </div>
      {entries.length === 0 ? null : (
        <div
          className={cn(
            RISE_CLASS,
            "mt-4 flex w-full flex-col gap-2 border-border border-t pt-3 delay-[360ms]"
          )}
        >
          {entries.map((entry) => (
            <SecondaryEntryRow entry={entry} key={entry.url} />
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineCard({
  secondaryEntries,
  taskId,
}: {
  secondaryEntries: Entry[];
  taskId: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-lg bg-white/[0.05] px-4 py-4"
      data-slot="deployment-task-timeline"
    >
      <div className="pointer-events-none absolute inset-px rounded-[calc(var(--radius-lg)-1px)] border" />
      <div className="mb-2.5 flex items-center gap-2 text-foreground">
        <Rocket aria-hidden className="size-4 text-foreground" />
        <h3 className="font-medium text-sm leading-5">Deployment Timeline</h3>
      </div>
      <p className="mb-2 truncate font-mono text-[11px] text-muted-foreground">
        {taskId}
      </p>
      <div className="mb-4 flex items-center gap-2 text-muted-foreground text-sm leading-5">
        <span className="size-2 rounded-full bg-emerald-500" />
        <span>Completed</span>
      </div>

      <Collapsible className="flex flex-col">
        <CollapsibleTrigger
          className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-md text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30"
          type="button"
        >
          <span className="min-w-0 truncate text-muted-foreground text-sm leading-5">
            View deployment details
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 flex flex-col gap-4">
            {TIMELINE_STEPS.map((step) => (
              <div className="flex min-w-0 items-center gap-2" key={step}>
                <CheckCircle2
                  aria-hidden
                  className="size-3.5 shrink-0 text-emerald-500"
                />
                <span className="min-w-0 flex-1 truncate text-foreground text-sm leading-5">
                  {step}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <SuccessRecord entries={secondaryEntries} />
    </div>
  );
}

function DeploymentTimelineSuccessDemo() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <TimelineCard secondaryEntries={[]} taskId="task_affine_template_01" />
      <TimelineCard
        secondaryEntries={SECONDARY_ENTRIES}
        taskId="task_affine_template_02"
      />
    </div>
  );
}

export default function DeploymentTimelineSuccessPreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview
        className="min-h-[620px] justify-center"
        showMaximize
        showReset
        title="Timeline — verified deployment success"
      >
        <DeploymentTimelineSuccessDemo />
      </Preview>
    </PreviewWrapper>
  );
}
