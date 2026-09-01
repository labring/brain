"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import { ExternalLink, Info, TriangleAlert, X } from "lucide-react";
import Link from "next/link";

import type { BillingCta } from "@/features/billing/billing-cta";
import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";
import { BILLING_SURFACE_TONES } from "@/features/billing/billing-surface-tones";
import { useResolvedBillingCta } from "@/features/billing/use-billing-cta";

import type { StatusHint } from "./status-hint-model";
import { useStatusHint } from "./use-status-hint";

/**
 * The status hint surface (design spec §7): a full-width tinted strip at the
 * very top of the content area, in document flow, that explains a holding
 * billing state and offers the fix. One tonal recipe across tones — a
 * payment-due stage only ever changes its words, never its visuals.
 */

/**
 * One CTA chip — the shared notification CTA recipe (app-button's chip
 * variant, ADR-0071), tinted by the banner's tone through currentColor.
 * A Desktop-resolved top-up CTA leaves in a new tab; everything else is a
 * full-page hop into the Billing Area with the return route recorded. The
 * quiet chip is the secondary way out beside a plan-first quota CTA.
 */
function StatusHintCtaChip({
  cta,
  quiet = false,
}: {
  cta: BillingCta;
  quiet?: boolean;
}) {
  const resolved = useResolvedBillingCta(cta);
  const variant = quiet ? "chip-quiet" : "chip";
  if (resolved.external) {
    return (
      <AppButton
        className="shrink-0"
        nativeButton={false}
        render={
          <a href={resolved.href} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden data-icon="inline-start" />
            {resolved.label}
          </a>
        }
        size="sm"
        variant={variant}
      />
    );
  }
  return (
    <AppButton
      className="shrink-0"
      nativeButton={false}
      render={
        <Link href={resolved.href} onClick={recordBillingReturnRoute}>
          {resolved.label}
        </Link>
      }
      size="sm"
      variant={variant}
    />
  );
}

export function StatusHintBannerView({
  hint,
  onDismiss,
}: {
  hint: StatusHint;
  onDismiss: () => void;
}) {
  const Icon = hint.tone === "info" ? Info : TriangleAlert;
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center gap-2.5 px-4 py-2 text-sm",
        BILLING_SURFACE_TONES[hint.tone]
      )}
      data-slot="status-hint-banner"
      data-state={hint.id}
      data-tone={hint.tone}
      // A destructive state is an alert the user must not miss; the
      // dismissible ones are polite status.
      role={hint.dismissible ? "status" : "alert"}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="shrink-0 whitespace-nowrap font-medium">
          {hint.title}
        </span>
      </span>
      <span className="hidden min-w-0 max-w-lg truncate text-muted-foreground lg:inline">
        {hint.description}
      </span>
      <StatusHintCtaChip cta={hint.cta} />
      {hint.secondaryCta == null ? null : (
        <StatusHintCtaChip cta={hint.secondaryCta} quiet />
      )}
      {hint.dismissible ? (
        <AppIconButton
          aria-label="Dismiss"
          className="absolute right-2 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          size="sm"
          variant="quiet"
        >
          <X aria-hidden />
        </AppIconButton>
      ) : null}
    </div>
  );
}

/**
 * The connected banner. Mounted at the top of every app shell's content
 * column (project and Billing Area alike); renders nothing while no state
 * holds. The Plan view's own subscription warning stays — it owns "what
 * next on this page", the banner owns the global state.
 */
export function StatusHintBanner() {
  const { dismiss, hint } = useStatusHint();
  if (hint == null) {
    return null;
  }
  return (
    <StatusHintBannerView hint={hint} onDismiss={() => dismiss(hint.id)} />
  );
}
