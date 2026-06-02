"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import { ArrowRight, Check, Loader2, Plus, Rocket, Trash2 } from "lucide-react";

const variants = [
  {
    label: "Primary",
    value: "primary",
    icon: Rocket,
    copy: "Main product action",
  },
  {
    label: "Secondary",
    value: "secondary",
    icon: Check,
    copy: "Neutral follow-up action",
  },
  {
    label: "Quiet",
    value: "quiet",
    icon: Trash2,
    copy: "Low-emphasis row action",
  },
  {
    label: "Danger",
    value: "danger",
    icon: Trash2,
    copy: "Destructive confirmation",
  },
  {
    label: "Link",
    value: "link",
    icon: Plus,
    copy: "Inline additive action",
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
        <div className="grid gap-3">
          {variants.map(({ label, value, icon: Icon, copy }) => (
            <div
              className="grid min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              key={value}
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground text-sm">{label}</p>
                <p className="text-muted-foreground text-xs leading-5">
                  {copy}
                </p>
              </div>
              <AppButton variant={value}>
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
