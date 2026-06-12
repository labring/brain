"use client";

import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import { Skeleton } from "@workspace/ui/components/skeleton";
import type { ReactNode } from "react";

function PreviewSurface({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-56 items-center justify-center overflow-hidden p-6">
      <div aria-hidden className="canvas-surface" />
      <div className="relative flex flex-wrap items-center justify-center gap-8">
        {children}
      </div>
    </div>
  );
}

function PlaceholderSample({
  children,
  selected,
}: {
  children?: ReactNode;
  selected?: boolean;
}) {
  return (
    <CanvasNode.Root interaction={{ selected }}>
      <CanvasNode.Placeholder aria-label="Canvas placeholder sample">
        {children}
      </CanvasNode.Placeholder>
    </CanvasNode.Root>
  );
}

function CustomPlaceholderContent() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="size-9 shrink-0 rounded-md bg-input" />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-2.5 w-16 bg-input" />
          <Skeleton className="h-2.5 w-10 bg-input" />
        </div>
        <Skeleton className="h-3 w-40 max-w-full bg-input" />
      </div>
    </div>
  );
}

export default function CanvasNodePreview() {
  return (
    <PreviewWrapper className="gap-10">
      <Preview title="Placeholder">
        <PreviewSurface>
          <PlaceholderSample />
        </PreviewSurface>
      </Preview>
      <Preview title="Placeholder — selected">
        <PreviewSurface>
          <PlaceholderSample selected />
        </PreviewSurface>
      </Preview>
      <Preview title="Placeholder — custom content">
        <PreviewSurface>
          <PlaceholderSample>
            <CustomPlaceholderContent />
          </PlaceholderSample>
        </PreviewSurface>
      </Preview>
    </PreviewWrapper>
  );
}
