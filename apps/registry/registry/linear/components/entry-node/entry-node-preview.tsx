"use client";

import type {
  EntryNodeAccessDomain,
  EntryNodeStates,
  EntryNodeTarget,
  EntryNodeTargetKey,
} from "@workspace/ui/components/entry-node/entry-node";
import { EntryNode } from "@workspace/ui/components/entry-node/entry-node";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import type { ReactNode } from "react";

import { EntryNodeCanvasHero } from "./entry-node-preview.canvas";

const entryNodeStates: EntryNodeStates = {
  name: "orders.demo.sealos.run",
};

const accessDomain: EntryNodeAccessDomain = {
  value: "orders.demo.sealos.run",
};

const accessibleTarget: EntryNodeTarget = {
  id: "public",
  label: "Platform Address",
  status: { label: "Accessible", tone: "accessible" },
  value: "https://orders.demo.sealos.run/",
};

const secondAccessibleTarget: EntryNodeTarget = {
  id: "public-secondary",
  label: "Platform Address",
  status: { label: "Accessible", tone: "accessible" },
  value: "https://api.orders.demo.sealos.run/",
};

const progressingTarget: EntryNodeTarget = {
  id: "progressing",
  label: "Platform Address",
  status: { label: "Progressing", tone: "progressing" },
  value: "https://orders-preview.demo.sealos.run/",
};

const failedTarget: EntryNodeTarget = {
  id: "failed",
  label: "Platform Address",
  status: { label: "Inaccessible", tone: "inaccessible" },
  value: "https://orders-failed.demo.sealos.run/",
};

const longAccessDomain: EntryNodeAccessDomain = {
  value:
    "orders-public-domain-with-a-very-long-entry-node-name.demo.sealos.run",
};

const longTarget: EntryNodeTarget = {
  id: "long-target",
  label: "Platform Address",
  status: { label: "Accessible", tone: "accessible" },
  value:
    "https://orders-public-domain-with-a-very-long-target-value.demo.sealos.run/",
};

const aggregateSamples: {
  title: string;
  targets: EntryNodeTarget[];
}[] = [
  { title: "Not configured", targets: [] },
  { title: "Accessible", targets: [accessibleTarget, secondAccessibleTarget] },
  {
    title: "Progressing",
    targets: [progressingTarget, { ...progressingTarget, id: "progressing-2" }],
  },
  { title: "Degraded", targets: [accessibleTarget, failedTarget] },
  { title: "Inaccessible", targets: [failedTarget] },
  {
    title: "Missing status",
    targets: [{ id: "missing", label: "Platform Address", value: "Pending" }],
  },
];

function PreviewSurface({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-36 items-center justify-center overflow-hidden p-6">
      <div aria-hidden className="canvas-surface" />
      <div className="relative">{children}</div>
    </div>
  );
}

function EntryNodeSample({
  access = accessDomain,
  copiedTargetKey,
  defaultExpanded = false,
  dragging,
  selected,
  targets = [accessibleTarget],
}: {
  access?: EntryNodeAccessDomain;
  copiedTargetKey?: EntryNodeTargetKey | null;
  defaultExpanded?: boolean;
  dragging?: boolean;
  selected?: boolean;
  targets?: EntryNodeTarget[];
}) {
  return (
    <EntryNode.Root
      accessDomain={access}
      copiedTargetKey={copiedTargetKey}
      defaultExpanded={defaultExpanded}
      interaction={{ dragging, selected }}
      states={entryNodeStates}
      targets={targets}
    >
      <EntryNode.Content />
    </EntryNode.Root>
  );
}

export default function EntryNodePreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-2">
      <Preview
        className="h-96"
        containerClassName="lg:col-span-2"
        showMaximize
        title="In canvas"
      >
        <EntryNodeCanvasHero />
      </Preview>
      <Preview title="Collapsed default">
        <PreviewSurface>
          <EntryNodeSample />
        </PreviewSurface>
      </Preview>
      <Preview title="Collapsed selected">
        <PreviewSurface>
          <EntryNodeSample selected />
        </PreviewSurface>
      </Preview>
      <Preview title="Expanded one target">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded />
        </PreviewSurface>
      </Preview>
      <Preview title="Expanded selected">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded selected />
        </PreviewSurface>
      </Preview>
      <Preview title="Expanded two targets">
        <PreviewSurface>
          <EntryNodeSample
            defaultExpanded
            targets={[accessibleTarget, secondAccessibleTarget]}
          />
        </PreviewSurface>
      </Preview>
      <Preview title="Scrollable targets">
        <PreviewSurface>
          <EntryNodeSample
            defaultExpanded
            targets={[
              accessibleTarget,
              secondAccessibleTarget,
              progressingTarget,
              failedTarget,
            ]}
          />
        </PreviewSurface>
      </Preview>
      <Preview title="Empty targets">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded targets={[]} />
        </PreviewSurface>
      </Preview>
      <Preview title="Copied feedback">
        <PreviewSurface>
          <EntryNodeSample
            copiedTargetKey="public"
            defaultExpanded
            targets={[accessibleTarget, secondAccessibleTarget]}
          />
        </PreviewSurface>
      </Preview>
      <Preview title="Drag visual">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded dragging />
        </PreviewSurface>
      </Preview>
      <Preview title="Long values">
        <PreviewSurface>
          <EntryNodeSample
            access={longAccessDomain}
            defaultExpanded
            targets={[longTarget]}
          />
        </PreviewSurface>
      </Preview>
      <Preview containerClassName="lg:col-span-2" title="Aggregate status">
        <PreviewSurface>
          <div className="flex flex-wrap items-start gap-3">
            {aggregateSamples.map((sample) => (
              <div className="flex flex-col gap-2" key={sample.title}>
                <EntryNodeSample targets={sample.targets} />
                <span className="text-muted-foreground text-xs">
                  {sample.title}
                </span>
              </div>
            ))}
          </div>
        </PreviewSurface>
      </Preview>
    </PreviewWrapper>
  );
}
