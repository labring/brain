"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import { Info, TriangleAlert, X } from "lucide-react";
import Link from "next/link";

import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";

import type { StatusHint, StatusHintTone } from "./status-hint-model";
import { useStatusHint } from "./use-status-hint";

/**
 * The status hint surface (design spec §7): a full-width tinted strip at the
 * very top of the content area, in document flow, that explains a holding
 * billing state and offers the fix. One tonal recipe across tones — a
 * payment-due stage only ever changes its words, never its visuals.
 */

// Same tint recipe as the Billing Area's subscription warning banner.
const SURFACE_TONES: Record<StatusHintTone, string> = {
  destructive: "bg-red-500/10 text-destructive",
  info: "bg-blue-400/10 text-blue-600 dark:text-blue-400",
  warning: "bg-amber-400/10 text-amber-600 dark:text-amber-400",
};

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
        SURFACE_TONES[hint.tone]
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
      <AppButton
        // Tonal: the tint recipe one step deeper, identical across tones.
        className="shrink-0 bg-current/15 text-current hover:bg-current/25"
        nativeButton={false}
        render={
          <Link href={hint.cta.href} onClick={recordBillingReturnRoute}>
            {hint.cta.label}
          </Link>
        }
        size="sm"
        variant="secondary"
      />
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
