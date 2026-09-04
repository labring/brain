"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Rocket,
  RotateCw,
} from "lucide-react";
import { useState } from "react";

import { DeploymentTaskSuccessConfetti } from "../../../../../ui/src/features/deploy/deployment-task-success-confetti";

const PUBLIC_DOMAIN = "https://affine.demo.sealos.run";

function TimelineStep({ children }: { children: string }) {
  return (
    <li className="flex items-center gap-2 text-muted-foreground text-xs leading-5">
      <CheckCircle2 aria-hidden className="size-3.5 text-emerald-500" />
      <span>{children}</span>
    </li>
  );
}

function DeploymentTimelineSuccessDemo() {
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const copyDomain = async () => {
    try {
      await navigator.clipboard.writeText(PUBLIC_DOMAIN);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
      <div className="flex justify-end">
        <AppButton
          onClick={() => setCelebrationKey((key) => key + 1)}
          size="sm"
          variant="secondary"
        >
          <RotateCw aria-hidden data-icon="inline-start" />
          Replay confetti
        </AppButton>
      </div>

      <div
        className="relative overflow-hidden rounded-lg bg-white/[0.05] px-4 py-4"
        data-slot="deployment-task-timeline"
      >
        <div className="pointer-events-none absolute inset-px rounded-[calc(var(--radius-lg)-1px)] border" />
        <DeploymentTaskSuccessConfetti active key={celebrationKey} />

        <div className="mb-2.5 flex items-center gap-2 text-foreground">
          <Rocket aria-hidden className="size-4 text-foreground" />
          <h3 className="font-medium text-sm leading-5">Deployment Timeline</h3>
        </div>
        <p className="mb-2 truncate font-mono text-[11px] text-muted-foreground">
          task_affine_template_01
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
              View deployment process
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-3 flex flex-col gap-1.5 border-border/60 border-l pl-4">
              <TimelineStep>Prepare template</TimelineStep>
              <TimelineStep>Create resources</TimelineStep>
              <TimelineStep>Verify workload and public domain</TimelineStep>
            </ol>
          </CollapsibleContent>
        </Collapsible>

        <div
          className="relative mt-4 flex flex-col gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4"
          data-slot="deployment-task-success"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <CheckCircle2
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-emerald-500"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="break-words font-medium text-foreground text-sm leading-5">
                  You can start using it
                </p>
                <p className="truncate text-muted-foreground text-xs leading-4">
                  AFFiNE
                </p>
              </div>
            </div>
            <AppButton
              className="shrink-0"
              nativeButton={false}
              render={
                <a
                  href={PUBLIC_DOMAIN}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ExternalLink aria-hidden data-icon="inline-start" />
                  Open
                </a>
              }
              size="sm"
            />
          </div>

          <div
            className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-input/30 px-3 py-2 transition-colors hover:bg-input"
            data-slot="deployment-task-success-entry"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-muted-foreground text-xs leading-4">
                Public domain
              </span>
              <span
                className="truncate font-mono text-foreground text-xs leading-4"
                title={PUBLIC_DOMAIN}
              >
                {PUBLIC_DOMAIN}
              </span>
            </div>
            <AppIconButton
              aria-label={copied ? "Address copied" : "Copy address"}
              onClick={copyDomain}
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

          <p className="text-muted-foreground text-xs leading-4">
            2/2 checks passed · verified just now
          </p>
        </div>
      </div>
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
