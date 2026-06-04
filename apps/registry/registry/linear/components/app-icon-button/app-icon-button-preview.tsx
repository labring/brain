"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import {
  Check,
  Copy,
  Database,
  Ellipsis,
  Loader2,
  MoreHorizontal,
  PanelRightOpen,
  Rocket,
  Settings,
  Terminal,
  Trash2,
  X,
} from "lucide-react";

const variants = [
  {
    label: "Primary",
    value: "primary",
    icon: Rocket,
  },
  {
    label: "Secondary",
    value: "secondary",
    icon: Database,
  },
  {
    label: "Quiet",
    value: "quiet",
    icon: Settings,
  },
  {
    label: "Danger",
    value: "danger",
    icon: Trash2,
  },
  {
    label: "Node",
    value: "node",
    icon: Terminal,
  },
] as const;

const sizes = [
  { label: "Small", value: "sm", icon: X },
  { label: "Medium", value: "md", icon: Terminal },
  { label: "Large", value: "lg", icon: PanelRightOpen },
] as const;

export default function AppIconButtonPreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Variants">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {variants.map(({ label, value, icon: Icon }) => (
            <div
              className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border/80 bg-muted/25 px-3 py-2"
              key={value}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground text-sm">
                  {label}
                </p>
                <p className="truncate text-muted-foreground text-xs">
                  {value}
                </p>
              </div>
              <AppIconButton aria-label={label} variant={value}>
                <Icon aria-hidden />
              </AppIconButton>
            </div>
          ))}
        </div>
      </Preview>

      <Preview title="Sizes">
        <div className="flex flex-wrap items-end gap-4">
          {sizes.map(({ label, value, icon: Icon }) => (
            <div className="flex flex-col items-center gap-2" key={value}>
              <AppIconButton aria-label={label} size={value} variant="quiet">
                <Icon aria-hidden />
              </AppIconButton>
              <span className="text-muted-foreground text-xs">{label}</span>
            </div>
          ))}
        </div>
      </Preview>

      <Preview title="States">
        <div className="flex flex-wrap items-center gap-3">
          <AppIconButton aria-label="Ready" variant="quiet">
            <Check aria-hidden />
          </AppIconButton>
          <AppIconButton aria-expanded aria-label="Open" variant="quiet">
            <MoreHorizontal aria-hidden />
          </AppIconButton>
          <AppIconButton aria-current="page" aria-label="Current page">
            <PanelRightOpen aria-hidden />
          </AppIconButton>
          <AppIconButton aria-label="Copy" variant="secondary">
            <Copy aria-hidden />
          </AppIconButton>
          <AppIconButton aria-label="Loading" disabled variant="secondary">
            <Loader2 aria-hidden className="animate-spin" />
          </AppIconButton>
          <AppIconButton aria-expanded aria-label="Node menu" variant="node">
            <Ellipsis aria-hidden />
          </AppIconButton>
          <AppIconButton aria-label="Disabled" disabled>
            <Settings aria-hidden />
          </AppIconButton>
        </div>
      </Preview>

      <Preview title="Product contexts">
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-medium text-foreground text-sm">
                  Pane header
                </h3>
                <p className="truncate text-muted-foreground text-xs">
                  Compact close control
                </p>
              </div>
              <AppIconButton aria-label="Close pane" size="sm">
                <X aria-hidden />
              </AppIconButton>
            </div>
          </section>

          <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-medium text-foreground text-sm">
                  Assistant rail
                </h3>
                <p className="truncate text-muted-foreground text-xs">
                  Prominent persistent toggle
                </p>
              </div>
              <AppIconButton
                aria-label="Open assistant pane"
                size="lg"
                variant="quiet"
              >
                <PanelRightOpen aria-hidden />
              </AppIconButton>
            </div>
          </section>

          <section className="dark flex min-w-0 items-center justify-between gap-3 rounded-lg border border-white/10 bg-neutral-950 p-4 text-foreground">
            <div className="min-w-0">
              <h3 className="truncate font-medium text-sm text-zinc-50">
                Canvas controls
              </h3>
              <p className="truncate text-xs text-zinc-400">
                Medium controls on dark surfaces
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <AppIconButton aria-label="Open terminal" variant="node">
                <Terminal aria-hidden />
              </AppIconButton>
              <AppIconButton
                aria-expanded
                aria-label="Node actions"
                variant="node"
              >
                <Ellipsis aria-hidden />
              </AppIconButton>
            </div>
          </section>
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
