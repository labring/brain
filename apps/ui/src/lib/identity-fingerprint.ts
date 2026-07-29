import "server-only";

import { getAssistantDb } from "@/features/chat/persistence/db";

import { createIdentityFingerprintStore } from "./identity-fingerprint-core";

export type {
  IdentityFingerprintObservation,
  ObservedIdentityBinding,
  ObserveIdentityFingerprint,
} from "./identity-fingerprint-core";

/** The region-local Identity Fingerprint store (ADR-0059). */
export const observeIdentityFingerprint =
  createIdentityFingerprintStore(getAssistantDb);
