"use client";

import type {
  ContainerNodeAction,
  ContainerNodeLifecycleActions,
  ContainerNodeQuickActions,
  ContainerNodeStates,
} from "@workspace/ui/components/container-node/container-node";
import { ContainerNode } from "@workspace/ui/components/container-node/container-node";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { ContainerNodeCanvasHero } from "./container-node-preview.canvas";

const staticBase = {
  image: "registry.example.io/demo:v2",
  kind: "AP",
  name: "workload-demo-001",
  replicas: 3,
} as const;

const RUN_CPU_STEPS = [12, 18, 23, 23, 40, 55, 55, 62, 70, 70, 78] as const;
const RUN_MEM_STEPS = [28, 35, 45, 45, 52, 60, 60, 68, 75, 75, 82] as const;

type PreviewStatusVariant = "failed" | "paused" | "running";

const demoAction = { onClick: () => undefined } satisfies ContainerNodeAction;

const demoLifecycleActions = {
  delete: demoAction,
  restart: demoAction,
  start: demoAction,
  stop: demoAction,
} satisfies ContainerNodeLifecycleActions;

const demoQuickActions = {
  calendar: demoAction,
  terminal: demoAction,
  logs: demoAction,
  metrics: demoAction,
} satisfies ContainerNodeQuickActions;

function PreviewSurface({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-44 items-center justify-center overflow-hidden p-6">
      <div aria-hidden className="canvas-surface" />
      <div className="relative">{children}</div>
    </div>
  );
}

function previewNameSuffix(variant: PreviewStatusVariant): string {
  if (variant === "running") {
    return "running";
  }
  if (variant === "failed") {
    return "failed";
  }
  return "paused";
}

function buildPreviewStates(
  variant: PreviewStatusVariant,
  liveStep: number
): ContainerNodeStates {
  const base = {
    ...staticBase,
    name: `${staticBase.name}-${previewNameSuffix(variant)}`,
  };
  if (variant === "running") {
    return {
      ...base,
      metrics: {
        cpu: RUN_CPU_STEPS[liveStep],
        memory: RUN_MEM_STEPS[liveStep],
      },
      readyReplicas: 3,
      status: { label: "Running", tone: "running" },
    };
  }
  if (variant === "failed") {
    return {
      ...base,
      metrics: {},
      readyReplicas: 1,
      status: { label: "Failed", tone: "failed" },
    };
  }
  return {
    ...base,
    metrics: {},
    readyReplicas: 0,
    replicas: 0,
    status: { label: "Paused", tone: "paused" },
  };
}

function ContainerNodeSample({
  defaultExpanded,
  states,
}: {
  defaultExpanded?: boolean;
  states: ContainerNodeStates;
}) {
  return (
    <ContainerNode.Root
      defaultExpanded={defaultExpanded}
      lifecycleActions={demoLifecycleActions}
      quickActions={demoQuickActions}
      states={states}
    >
      <ContainerNode.Content />
    </ContainerNode.Root>
  );
}

function StatusVariantRows({ defaultExpanded }: { defaultExpanded?: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStep((s) => (s + 1) % RUN_CPU_STEPS.length);
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-wrap items-start justify-center gap-8">
      <ContainerNodeSample
        defaultExpanded={defaultExpanded}
        states={buildPreviewStates("running", step)}
      />
      <ContainerNodeSample
        defaultExpanded={defaultExpanded}
        states={buildPreviewStates("failed", 0)}
      />
      <ContainerNodeSample
        defaultExpanded={defaultExpanded}
        states={buildPreviewStates("paused", 0)}
      />
    </div>
  );
}

export default function ContainerNodePreview() {
  return (
    <PreviewWrapper className="gap-10">
      <Preview
        className="h-96"
        containerClassName="lg:col-span-2"
        showMaximize
        title="In canvas"
      >
        <ContainerNodeCanvasHero />
      </Preview>
      <Preview title="Expanded — running (live usage) · failed · paused">
        <PreviewSurface>
          <StatusVariantRows defaultExpanded />
        </PreviewSurface>
      </Preview>
      <Preview title="Collapsed — running · failed · paused">
        <PreviewSurface>
          <StatusVariantRows />
        </PreviewSurface>
      </Preview>
    </PreviewWrapper>
  );
}
