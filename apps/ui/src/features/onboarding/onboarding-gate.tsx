"use client";

import { type DialConfig, useDialKit } from "@workspace/dev-tweaks";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

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
  DismissOnboardingProfileRequest,
} from "./types";

// While forced, every write is inert and `open || forceOpen` keeps the
// dialog up — it cannot be closed from inside; switching the knob off is
// the only exit. This protects the developer's real sampling state.
// `previewStep` (0 follows the survey · 1-4 force a step) is only honored
// while the modal is forced: preview never redirects a real survey in
// progress, where the forced-looking step could submit.
const ONBOARDING_TWEAKS = {
  forceModal: false,
  previewStep: [0, 0, 4, 1],
} satisfies DialConfig;

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
  const [openForKey, setOpenForKey] = useState<string | null>(null);
  const values = useDialKit("Onboarding · sampling dialog", ONBOARDING_TWEAKS, {
    id: "onboarding",
    persist: { storage: "sessionStorage" },
  });
  const forceOpen = process.env.NODE_ENV === "development" && values.forceModal;
  const previewStep =
    forceOpen && values.previewStep >= 1 && values.previewStep <= 4
      ? Math.round(values.previewStep)
      : undefined;

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
    const key = onboardingCredentialsKey(credentials);
    const { promise } = obtainOnboardingSessionJudgment({
      judge: () =>
        judgeOnboardingSampling({
          fetchVerdict: () => fetchOnboardingSamplingVerdict(credentials),
        }),
      key,
    });
    let disposed = false;
    promise.then(
      (shouldOpen) => {
        if (!disposed && shouldOpen) {
          setOpenForKey(key);
        }
      },
      () => undefined
    );
    return () => {
      disposed = true;
    };
  }, [appToken, kubeconfig, namespace]);

  // Open derives from which identity's judgment opened the dialog: on a
  // mid-session rekey the credential key stops matching and the dialog
  // closes in the same render — whatever the discarded identity's judgment
  // opened must not survive it; the new judgment reopens it if it should.
  // Credentials going momentarily unready leave an open dialog open.
  const renderedKey = onboardingCredentialsReady({
    appToken,
    kubeconfig,
    namespace,
  })
    ? onboardingCredentialsKey({ appToken, kubeconfig, namespace })
    : null;
  const open =
    openForKey !== null && (renderedKey === null || renderedKey === openForKey);

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
    setOpenForKey(null);
    fireWrite((credentials) => {
      completeOnboardingProfile(credentials, payload);
      // Settled at the action, deliberately not at the write's success: the
      // session judgment records "this person terminated the survey this
      // session", so a Gate remount (client-side navigation away and back)
      // never reopens a survey the person just finished — even if the write
      // fails. Durability doesn't ride on this cache: the next full page
      // load re-judges from the database, and a lost terminal write means
      // re-asking then, with the stepwise-persisted answers still in place.
      settleOnboardingSessionJudgmentSampled(
        onboardingCredentialsKey(credentials)
      );
    });
  };

  const handleSkip = (payload: DismissOnboardingProfileRequest) => {
    // Skip drops the person into the console immediately; the terminal
    // write never blocks the exit.
    setOpenForKey(null);
    fireWrite((credentials) => {
      dismissOnboardingProfile(credentials, payload);
      // Same action-time settle as complete: never re-ask in the same
      // session someone just declined; the database re-judgment on the next
      // page load is the recovery path for a lost write.
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
      previewStep={previewStep}
    />
  );
}
