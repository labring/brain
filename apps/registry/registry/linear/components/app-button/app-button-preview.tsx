"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import { ArrowRight, Check, Loader2, Plus, Rocket, Trash2 } from "lucide-react";

const variants = [
  {
    label: "Primary",
    value: "primary",
    icon: Rocket,
  },
  {
    label: "Secondary",
    value: "secondary",
    icon: Check,
  },
  {
    label: "Quiet",
    value: "quiet",
    icon: Trash2,
  },
  {
    label: "Danger",
    value: "danger",
    icon: Trash2,
  },
] as const;

const sizes = [
  { label: "Small", value: "sm" },
  { label: "Default", value: "default" },
  { label: "Large", value: "lg" },
] as const;

export default function AppButtonPreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Variants">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {variants.map(({ label, value, icon: Icon }) => (
            <div
              className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/80 bg-muted/25 px-3 py-2"
              key={value}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground text-sm">
                  {label}
                </p>
              </div>
              <AppButton className="shrink-0" variant={value}>
                <Icon aria-hidden data-icon="inline-start" />
                {label}
              </AppButton>
            </div>
          ))}
        </div>
      </Preview>

      <Preview title="Sizes">
        <div className="flex flex-wrap items-center gap-3">
          {sizes.map(({ label, value }) => (
            <AppButton key={value} size={value} variant="primary">
              <Plus aria-hidden data-icon="inline-start" />
              {label}
            </AppButton>
          ))}
        </div>
      </Preview>

      <Preview title="States">
        <div className="flex flex-wrap items-center gap-3">
          <AppButton>
            Ready
            <ArrowRight aria-hidden data-icon="inline-end" />
          </AppButton>
          <AppButton disabled>
            <ArrowRight aria-hidden data-icon="inline-start" />
            Disabled
          </AppButton>
          <AppButton aria-busy="true" disabled variant="secondary">
            <Loader2
              aria-hidden
              className="animate-spin"
              data-icon="inline-start"
            />
            Loading
          </AppButton>
        </div>
      </Preview>

      <Preview title="Product combinations">
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="min-w-0">
              <h3 className="font-medium text-foreground text-sm">
                Dialog footer
              </h3>
              <p className="text-muted-foreground text-xs leading-5">
                Secondary action sits beside the primary submit action.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AppButton variant="secondary">Cancel</AppButton>
              <AppButton>
                <Check aria-hidden data-icon="inline-start" />
                Save
              </AppButton>
            </div>
          </section>

          <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="min-w-0">
              <h3 className="font-medium text-foreground text-sm">
                Row action
              </h3>
              <p className="text-muted-foreground text-xs leading-5">
                Quiet keeps repeated actions present without dominating rows.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AppButton className="min-w-24" variant="quiet">
                Edit
              </AppButton>
              <AppButton variant="quiet">
                <Trash2 aria-hidden data-icon="inline-start" />
                Delete
              </AppButton>
            </div>
          </section>
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
