"use client";

import { type DevTweaksConfig, useDevTweaks } from "@workspace/dev-tweaks";

import type { FreeTierState } from "./persistence/types";

// Mirrors DEFAULT_FREE_CHAT_TURNS (persistence/free-tier.ts): the counter
// card draws `limit` pips, so the slider range tracks the real allowance.
const FREE_CHAT_TURNS_LIMIT = 5;

const CHAT_BILLING_CARD_TWEAKS = {
  override: false,
  posture: {
    default: "counter",
    options: [
      { label: "Counter (free turns)", value: "counter" },
      { label: "0 turns — user handoff", value: "handoff" },
      { label: "Paid wall — AI Credits", value: "wall-ai-credits" },
      { label: "Paid wall — balance", value: "wall-balance" },
    ],
    type: "select",
  },
  remaining: [2, 1, FREE_CHAT_TURNS_LIMIT, 1],
} satisfies DevTweaksConfig;

// Same build gate as the panel itself (dev-tweaks.tsx): the knob may only
// ever act where the panel that flips it can exist.
const TWEAKABLE_BUILD =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_TWEAKS === "1";

/**
 * Styling override for the pane's billing card slot: while the panel toggle
 * is on, the posture select fabricates the rendered Chat Billing Posture —
 * the counter card at 1–5 pips (the slider), the real 0-free-turns state
 * (a `user` handoff with no wall and an open composer, ADR-0069), or the
 * Paid Chat Wall in either Paid Source voice (AI Credits vs balance), which
 * locks the composer. The wall is its own option rather than the slider's
 * zero because real remaining=0 shows no wall — the wall belongs to an
 * exhausted Paid Source, and its copy forks on which one. A tweak, not a
 * Dev Mock, and deliberately chat-pane-only: the server, the sidebar's
 * free-turns row, and the Plan view keep their real state, so ADR-0065's
 * server-computed posture is only ever overridden where the dev tweaks
 * panel exists.
 */
export function useChatBillingCardFreeTierOverride(): FreeTierState | null {
  const values = useDevTweaks("Chat · billing card", CHAT_BILLING_CARD_TWEAKS, {
    id: "chat-billing-card",
    persist: { storage: "sessionStorage" },
  });
  if (!(TWEAKABLE_BUILD && values.override)) {
    return null;
  }
  if (
    values.posture === "wall-ai-credits" ||
    values.posture === "wall-balance"
  ) {
    const source =
      values.posture === "wall-ai-credits" ? "ai-credits" : "balance";
    return {
      billing: "user",
      limit: FREE_CHAT_TURNS_LIMIT,
      paidSource: source,
      remaining: 0,
      wall: source,
    };
  }
  if (values.posture === "handoff") {
    return {
      billing: "user",
      limit: FREE_CHAT_TURNS_LIMIT,
      paidSource: null,
      remaining: 0,
      wall: null,
    };
  }
  const remaining = Math.min(
    FREE_CHAT_TURNS_LIMIT,
    Math.max(1, Math.round(values.remaining))
  );
  return {
    billing: "free",
    limit: FREE_CHAT_TURNS_LIMIT,
    paidSource: null,
    remaining,
    wall: null,
  };
}
