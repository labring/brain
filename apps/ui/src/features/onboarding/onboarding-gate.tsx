"use client";

import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

import { useDevTweaks } from "@/features/dev-tweaks/use-dev-tweaks";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

import {
  answerOnboardingStep,
  completeOnboardingProfile,
  dismissOnboardingProfile,
  fetchOnboardingSamplingVerdict,
  type OnboardingFetcherCredentials,
} from "./client";
import { OnboardingDialog } from "./onboarding-dialog";
import {
  judgeOnboardingSampling,
  obtainOnboardingSessionJudgment,
  onboardingCredentialsKey,
  onboardingCredentialsReady,
  settleOnboardingSessionJudgmentSampled,
} from "./onboarding-gate-core";
import type {
  AnswerOnboardingStepRequest,
  CompleteOnboardingProfileRequest,
} from "./types";

// While forced, every write is inert and `open || forceOpen` keeps the
// dialog up — it cannot be closed from inside; switching the knob off is
// the only exit. This protects the developer's real sampling state.
const ONBOARDING_TWEAKS = {
  note: "Opens the dialog unconditionally; Skip/Submit are inert while forced and the dialog stays open until the knob is switched off, so sampling state stays untouched.",
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
    const { promise, rekeyed } = obtainOnboardingSessionJudgment({
      judge: () =>
        judgeOnboardingSampling({
          fetchVerdict: () => fetchOnboardingSamplingVerdict(credentials),
        }),
      key: onboardingCredentialsKey(credentials),
    });
    if (rekeyed) {
      // Whatever the discarded identity's judgment opened must not survive
      // it; the new judgment below reopens the dialog if it should.
      setOpen(false);
    }
    let disposed = false;
    promise.then(
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

  // The shared tail of every dialog write, all fire-and-forget: the
  // forced-open preview knob must never mutate the developer's real sampling
  // state, and missing credentials fail silently (terminal-wins keeps
  // retries harmless server-side).
  const fireWrite = (
    write: (credentials: OnboardingFetcherCredentials) => void
  ) => {
    if (forceOpen) {
      return;
    }
    if (onboardingCredentialsReady({ appToken, kubeconfig, namespace })) {
      write({
        appToken: appToken.trim(),
        kubeconfig,
        namespace: namespace.trim(),
      });
    }
  };

  const handleAnswerStep = (payload: AnswerOnboardingStepRequest) => {
    // Stepwise writes never block Next: the dialog advances on its own and
    // a silent failure just leaves the person Unsampled for next entry.
    fireWrite((credentials) => answerOnboardingStep(credentials, payload));
  };

  const handleComplete = (payload: CompleteOnboardingProfileRequest) => {
    // Submit & Enter Console drops the person into the console immediately;
    // the terminal write never blocks the exit.
    setOpen(false);
    fireWrite((credentials) => {
      completeOnboardingProfile(credentials, payload.openGoalText);
      // The session judgment must flip to Sampled with the write, or a Gate
      // remount would re-attach to the stale verdict and reopen the survey.
      settleOnboardingSessionJudgmentSampled(
        onboardingCredentialsKey(credentials)
      );
    });
  };

  const handleSkip = (payload: { dismissedAtStep: number }) => {
    // Skip drops the person into the console immediately; the terminal
    // write never blocks the exit.
    setOpen(false);
    fireWrite((credentials) => {
      dismissOnboardingProfile(credentials, payload.dismissedAtStep);
      settleOnboardingSessionJudgmentSampled(
        onboardingCredentialsKey(credentials)
      );
    });
  };

  return (
    <OnboardingDialog
      onAnswerStep={handleAnswerStep}
      onComplete={handleComplete}
      onSkip={handleSkip}
      open={open || forceOpen}
    />
  );
}
