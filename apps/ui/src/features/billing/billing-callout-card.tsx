"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { AppButton } from "@workspace/ui/components/app-button";
import { cn } from "@workspace/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";

import { recordBillingReturnRoute } from "./billing-return-route";

/**
 * The billing callout family (design spec rows E1–E3, AIM-325 variant B):
 * the one container a Billing Interruption, a billing wall, or the Deploy
 * Billing Notice renders in — icon, headline, one-line explanation, exactly
 * one CTA to the fix. Composes the shared Alert for its role, slots and icon
 * grid; the tint is the family's own rather than Alert's card-on-white
 * destructive variant, and the copy keeps the foreground/muted pair so the
 * semantic color stays on the icon and the border. Tones follow the status
 * hint banner's severity language (billing-surface-tones): destructive for a
 * refusal or a proven failure, warning for an advisory caution (ADR-0069).
 */
const CALLOUT_TONES = {
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  warning:
    "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-400",
} as const;

export type BillingCalloutTone = keyof typeof CALLOUT_TONES;

export function BillingCalloutCard({
  action,
  body,
  className,
  icon: Icon,
  layout = "stacked",
  title,
  tone = "destructive",
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  /** The CTA; the family always offers exactly one. */
  action: React.ReactNode;
  body: React.ReactNode;
  icon: LucideIcon;
  /**
   * `stacked` places the CTA under the copy (deployment panes, the
   * timeline); `inline` places it at the end of the row (the chat card slot,
   * beside its quiet Free Chat Turns siblings).
   */
  layout?: "inline" | "stacked";
  title: React.ReactNode;
  tone?: BillingCalloutTone;
}) {
  const inline = layout === "inline";
  return (
    <Alert
      className={cn(
        CALLOUT_TONES[tone],
        inline && "has-[>svg]:grid-cols-[auto_1fr_auto]",
        className
      )}
      {...props}
    >
      <Icon aria-hidden />
      <AlertTitle className="text-foreground">{title}</AlertTitle>
      <AlertDescription className="col-start-2 text-xs">
        {body}
      </AlertDescription>
      <div
        className={cn(
          inline
            ? "col-start-3 row-span-2 row-start-1 self-center"
            : "col-start-2 mt-2"
        )}
        data-slot="billing-callout-action"
      >
        {action}
      </div>
    </Alert>
  );
}

/**
 * The callout CTA as a full-page navigation into the Billing Area, recording
 * the route to return to once the fix is made.
 */
export function BillingCalloutLink({
  cta,
}: {
  cta: { href: string; label: string };
}) {
  return (
    <AppButton
      nativeButton={false}
      render={
        <Link href={cta.href} onClick={recordBillingReturnRoute}>
          {cta.label}
        </Link>
      }
      size="sm"
    />
  );
}
