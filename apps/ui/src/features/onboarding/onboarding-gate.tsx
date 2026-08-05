"use client";

import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

import { useDevTweaks } from "@/features/dev-tweaks/use-dev-tweaks";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

import {
  dismissOnboardingProfile,
  fetchOnboardingSamplingVerdict,
} from "./client";
import { OnboardingDialog } from "./onboarding-dialog";
import {
  judgeOnboardingSampling,
  onboardingCredentialsReady,
} from "./onboarding-gate-core";

const ONBOARDING_TWEAKS = {
  note: "Opens the dialog unconditionally; Skip is inert while forced, so sampling state stays untouched.",
  title: "Onboarding · sampling dialog",
  tweaks: {
    forceModal: {
      label: "Force onboarding modal (0 off · 1 on)",
      max: 1,
      min: 0,
      step: 1,
      value: 0,
    },
  },
} as const;

/**
 * One sampling judgment per session (page load): remounts re-attach to the
 * same promise instead of re-querying, and a failed or exhausted judgment
 * silently stands down until the next entry.
 */
let sessionJudgment: Promise<boolean> | null = null;

/** Test seam. */
export function resetOnboardingGateSessionForTesting(): void {
  sessionJudgment = null;
}

/**
 * The Onboarding Gate (ADR-0061): opportunistic and non-blocking. The console
 * always renders — this component mounts nothing visible until a definitive
 * Unsampled verdict opens the sampling dialog, and every failure on the way
 * is silent.
 */
export function OnboardingGate() {
  const appToken = useAtomValue(appTokenAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  const [open, setOpen] = useState(false);
  const { values } = useDevTweaks("onboarding", ONBOARDING_TWEAKS);
  const forceOpen =
    process.env.NODE_ENV === "development" && values.forceModal >= 0.5;

  useEffect(() => {
    // The app token arrives asynchronously from the Desktop SDK; with no
    // token this session, the gate does nothing (fail closed, no dialog).
    if (!onboardingCredentialsReady({ appToken, kubeconfig, namespace })) {
      return;
    }
    const credentials = {
      appToken: appToken.trim(),
      kubeconfig,
      namespace: namespace.trim(),
    };
    sessionJudgment ??= judgeOnboardingSampling({
      fetchVerdict: () => fetchOnboardingSamplingVerdict(credentials),
    });
    let disposed = false;
    sessionJudgment.then(
      (shouldOpen) => {
        if (!disposed && shouldOpen) {
          setOpen(true);
        }
      },
      () => undefined
    );
    return () => {
      disposed = true;
    };
  }, [appToken, kubeconfig, namespace]);

  const handleSkip = (payload: { dismissedAtStep: number }) => {
    // Skip drops the person into the console immediately; the terminal write
    // is fire-and-forget and never blocks the exit (terminal-wins keeps
    // retries harmless server-side).
    setOpen(false);
    if (forceOpen) {
      // Forced-open preview: the knob keeps the dialog up and must never
      // mutate the developer's real sampling state.
      return;
    }
    if (onboardingCredentialsReady({ appToken, kubeconfig, namespace })) {
      dismissOnboardingProfile(
        { appToken: appToken.trim(), kubeconfig, namespace: namespace.trim() },
        payload.dismissedAtStep
      );
    }
  };

  return <OnboardingDialog onSkip={handleSkip} open={open || forceOpen} />;
}
