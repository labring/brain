"use client";

import { type DevTweaksConfig, useDevTweaks } from "@workspace/dev-tweaks";

import type { FreeTierState } from "./persistence/types";

// Mirrors DEFAULT_FREE_CHAT_TURNS (persistence/free-tier.ts): the counter
// card draws `limit` pips, so the slider range tracks the real allowance.
const FREE_CHAT_TURNS_LIMIT = 5;

const CHAT_BILLING_CARD_TWEAKS = {
  override: false,
  remaining: [2, 0, FREE_CHAT_TURNS_LIMIT, 1],
} satisfies DevTweaksConfig;

// Same build gate as the panel itself (dev-tweaks.tsx): the knob may only
// ever act where the panel that flips it can exist.
const TWEAKABLE_BUILD =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_TWEAKS === "1";

/**
 * Styling override for the pane's billing card slot: while the panel toggle
 * is on, the slider fabricates the rendered Chat Billing Posture — 0 Free
 * Chat Turns left renders the blocked card (locking the composer, like the
 * real posture), 1–5 render the counter card. A tweak, not a Dev Mock, and
 * deliberately chat-pane-only: the server, the sidebar's free-turns row,
 * and the Plan view keep their real state, so ADR-0065's server-computed
 * posture is only ever overridden where the dev tweaks panel exists.
 */
export function useChatBillingCardFreeTierOverride(): FreeTierState | null {
  const values = useDevTweaks("Chat · billing card", CHAT_BILLING_CARD_TWEAKS, {
    id: "chat-billing-card",
    persist: { storage: "sessionStorage" },
  });
  if (!(TWEAKABLE_BUILD && values.override)) {
    return null;
  }
  const remaining = Math.min(
    FREE_CHAT_TURNS_LIMIT,
    Math.max(0, Math.round(values.remaining))
  );
  return {
    billing: remaining === 0 ? "blocked" : "free",
    limit: FREE_CHAT_TURNS_LIMIT,
    paidSource: null,
    remaining,
    wall: null,
  };
}
