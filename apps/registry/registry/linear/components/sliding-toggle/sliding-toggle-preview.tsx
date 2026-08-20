"use client";

import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import {
  SlidingToggle,
  type SlidingToggleOption,
} from "@workspace/ui/components/sliding-toggle";
import { Cpu, MemoryStick, RefreshCw, Server } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

type ReplicaStrategy = "elastic" | "fixed";
type ScalingTarget = "cpu" | "memory";
type RuntimeMode = "autoscale" | "manual" | "paused";
type CostView = "billing" | "trends";

function iconLabel(icon: ReactNode, label: string) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {label}
    </span>
  );
}

const replicaOptions = [
  {
    ariaLabel: "Fixed Replicas",
    label: "Fixed Replicas",
    value: "fixed",
  },
  {
    ariaLabel: "Elastic Scaling",
    label: "Elastic Scaling",
    value: "elastic",
  },
] as const satisfies readonly SlidingToggleOption<ReplicaStrategy>[];

const targetOptions = [
  {
    ariaLabel: "CPU utilization target",
    label: iconLabel(<Cpu aria-hidden className="size-3.5" />, "Target CPU"),
    value: "cpu",
  },
  {
    ariaLabel: "Memory average target",
    label: iconLabel(
      <MemoryStick aria-hidden className="size-3.5" />,
      "Target Memory"
    ),
    value: "memory",
  },
] as const satisfies readonly SlidingToggleOption<ScalingTarget>[];

const runtimeOptions = [
  {
    ariaLabel: "Manual replicas",
    label: iconLabel(<Server aria-hidden className="size-3.5" />, "Manual"),
    value: "manual",
  },
  {
    ariaLabel: "Autoscale",
    label: iconLabel(
      <RefreshCw aria-hidden className="size-3.5" />,
      "Autoscale"
    ),
    value: "autoscale",
  },
  {
    ariaLabel: "Paused",
    label: "Paused",
    value: "paused",
  },
] as const satisfies readonly SlidingToggleOption<RuntimeMode>[];

const costViewOptions = [
  {
    ariaLabel: "Billing details",
    label: "Billing",
    value: "billing",
  },
  {
    ariaLabel: "Cost and top-up trends",
    label: "Cost & Top-up Trends",
    value: "trends",
  },
] as const satisfies readonly SlidingToggleOption<CostView>[];

export default function SlidingTogglePreview() {
  const [replicaStrategy, setReplicaStrategy] =
    useState<ReplicaStrategy>("fixed");
  const [scalingTarget, setScalingTarget] = useState<ScalingTarget>("cpu");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("manual");
  const [costView, setCostView] = useState<CostView>("billing");

  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Default">
        <div className="w-full max-w-xl rounded-lg bg-white/5 p-3">
          <SlidingToggle
            ariaLabel="Replica Strategy"
            onValueChange={setReplicaStrategy}
            options={replicaOptions}
            value={replicaStrategy}
          />
        </div>
      </Preview>

      <Preview title="Small auto width">
        <div className="flex w-full max-w-xl items-center justify-between gap-3 rounded-lg bg-white/5 p-3">
          <SlidingToggle
            ariaLabel="Scaling target"
            onValueChange={setScalingTarget}
            options={targetOptions}
            size="sm"
            value={scalingTarget}
            width="auto"
          />
        </div>
      </Preview>

      <Preview title="Fit-width segments">
        <div className="w-full max-w-xl rounded-lg bg-white/5 p-3">
          <SlidingToggle
            ariaLabel="Cost views"
            className="w-fit border border-border bg-transparent"
            indicatorClassName="rounded-[calc(var(--radius-lg)-1px)]"
            itemClassName="!px-4"
            onValueChange={setCostView}
            options={costViewOptions}
            segments="fit"
            value={costView}
            width="auto"
          />
        </div>
      </Preview>

      <Preview title="Three options and disabled">
        <div className="grid w-full max-w-xl gap-3 rounded-lg bg-white/5 p-3">
          <SlidingToggle
            ariaLabel="Runtime mode"
            onValueChange={setRuntimeMode}
            options={runtimeOptions}
            value={runtimeMode}
          />
          <SlidingToggle
            ariaLabel="Disabled scaling target"
            disabled
            onValueChange={setScalingTarget}
            options={targetOptions}
            size="sm"
            value={scalingTarget}
            width="auto"
          />
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
