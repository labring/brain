"use client";

import { type DevTweaksConfig, useDevTweaks } from "@workspace/dev-tweaks";

/** How long a previewed Cancel Plan stays pending before it settles. */
export const CANCEL_PLAN_PREVIEW_PENDING_MS = 800;

const CANCEL_PLAN_DIALOG_TWEAKS = {
  openConfirmation: { label: "Open confirmation", type: "action" },
  openSurvey: { label: "Open survey", type: "action" },
  simulateFailure: false,
  withFeedback: true,
} satisfies DevTweaksConfig;

export type CancelPlanDialogPreviewStage = "confirmation" | "survey";

/** The preview knobs the dialog reads while a preview is open. */
export interface CancelPlanDialogPreviewOptions {
  /** A previewed Cancel Plan settles into the inline error, not the confirmation. */
  simulateFailure: boolean;
  /** The confirmation stage shows its thank-you line regardless of answers. */
  withFeedback: boolean;
}

const PREVIEW_DEFAULTS: CancelPlanDialogPreviewOptions = {
  simulateFailure: false,
  withFeedback: true,
};

// Same build gate as the panel itself (dev-tweaks.tsx): the knob may only
// ever act where the panel that flips it can exist. Read per call rather
// than hoisted so the gate is decided where the action fires.
function tweakableBuild(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_DEV_TWEAKS === "1"
  );
}

/**
 * Styling preview for the Cancellation Survey dialog: two panel buttons open
 * the dialog at either stage without a Cancel Plan trigger on the page and
 * regardless of the Billing mock's scenario. A preview never leaves the
 * page — no lifecycle request, no survey write, no analytics — and the two
 * toggles pick the settled state (confirmation vs inline error) and whether
 * the confirmation thanks for feedback. A tweak, not a Dev Mock, and
 * deliberately dialog-only: the Plan view around it keeps its real state,
 * so the section appears once the Plan view mounts.
 */
export function useCancelPlanDialogPreview(
  openPreview: (stage: CancelPlanDialogPreviewStage) => void
): CancelPlanDialogPreviewOptions {
  const values = useDevTweaks(
    "Billing · cancel plan",
    CANCEL_PLAN_DIALOG_TWEAKS,
    {
      id: "billing-cancel-plan",
      onAction: (action) => {
        if (!tweakableBuild()) {
          return;
        }
        if (action === "openSurvey") {
          openPreview("survey");
        } else if (action === "openConfirmation") {
          openPreview("confirmation");
        }
      },
      persist: { storage: "sessionStorage" },
    }
  );
  if (!tweakableBuild()) {
    return PREVIEW_DEFAULTS;
  }
  return {
    simulateFailure: values.simulateFailure,
    withFeedback: values.withFeedback,
  };
}
