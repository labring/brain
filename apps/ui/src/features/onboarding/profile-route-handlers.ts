import "server-only";

import { getAssistantDb } from "@/features/chat/persistence/db";

import { createOnboardingProfileHandlers } from "./profile-http-handlers";
import { createOnboardingProfileStore } from "./profile-store";

const store = createOnboardingProfileStore(getAssistantDb);

/** Production wiring for the Onboarding Profile routes (ADR-0061). */
export const onboardingProfileRouteHandlers = createOnboardingProfileHandlers({
  answerStep: store.answerStep,
  complete: store.complete,
  dismiss: store.dismiss,
  isSampled: store.isSampled,
});
