"use client";

import { type DevTweaksConfig, useDevTweaks } from "@workspace/dev-tweaks";

import type { ChatBillingInterruption } from "./chat-billing-interruption";
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
      { label: "0 turns — handoff (renders nothing)", value: "handoff" },
      { label: "Allowance notice — after trial", value: "notice-trial" },
      { label: "Allowance notice — plan without AI", value: "notice-plan" },
      {
        label: "Allowance wall — after trial (refused)",
        value: "allowance-wall-trial",
      },
      {
        label: "Allowance wall — plan without AI (refused)",
        value: "allowance-wall-plan",
      },
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

/** What the tweak forces on the pane: the posture, plus — for the refused
 * allowance-wall stages — the fabricated refusal that arms the lock. */
export interface ChatBillingCardOverride {
  freeTier: FreeTierState;
  interruption: ChatBillingInterruption | null;
}

/**
 * Styling override for the pane's billing card slot: while the panel toggle
 * is on, the posture select fabricates the rendered Chat Billing Posture —
 * the counter card at 1–5 pips (the slider), the true 0-free-turns handoff
 * (which deliberately renders NOTHING: an open composer on `user` billing,
 * ADR-0069 — pick an allowance or wall posture to see a card), the staged
 * allowance notice/wall pair (ADR-0073: the notice leaves the composer
 * open; the "refused" wall stages the post-refusal lock by fabricating the
 * interruption too), or the Paid Chat Wall in either Paid Source voice.
 * The wall is its own option rather than the slider's zero because real
 * remaining=0 shows no wall by itself. A tweak, not a Dev Mock, and
 * deliberately chat-pane-only: the server, the sidebar's free-turns row,
 * and the Plan view keep their real state (the billing Dev Mock's
 * `/api/chat/free-turns` fixture covers those), so ADR-0065's
 * server-computed posture is only ever overridden where the dev tweaks
 * panel exists.
 */
const FIXED_POSTURES: Record<string, ChatBillingCardOverride> = {
  "allowance-wall-plan": {
    freeTier: {
      billing: "user",
      limit: FREE_CHAT_TURNS_LIMIT,
      paidSource: "ai-credits",
      remaining: FREE_CHAT_TURNS_LIMIT,
      wall: "allowance-plan",
    },
    interruption: { allowance: "plan", paidSource: null },
  },
  "allowance-wall-trial": {
    freeTier: {
      billing: "user",
      limit: FREE_CHAT_TURNS_LIMIT,
      paidSource: "ai-credits",
      remaining: 0,
      wall: "allowance-trial",
    },
    interruption: { allowance: "trial", paidSource: null },
  },
  handoff: {
    freeTier: {
      billing: "user",
      limit: FREE_CHAT_TURNS_LIMIT,
      paidSource: null,
      remaining: 0,
      wall: null,
    },
    interruption: null,
  },
  "notice-plan": {
    freeTier: {
      billing: "user",
      limit: FREE_CHAT_TURNS_LIMIT,
      paidSource: "ai-credits",
      remaining: FREE_CHAT_TURNS_LIMIT,
      wall: "allowance-plan",
    },
    interruption: null,
  },
  "notice-trial": {
    freeTier: {
      billing: "user",
      limit: FREE_CHAT_TURNS_LIMIT,
      paidSource: "ai-credits",
      remaining: 0,
      wall: "allowance-trial",
    },
    interruption: null,
  },
  "wall-ai-credits": {
    freeTier: {
      billing: "user",
      limit: FREE_CHAT_TURNS_LIMIT,
      paidSource: "ai-credits",
      remaining: 0,
      wall: "ai-credits",
    },
    interruption: null,
  },
  "wall-balance": {
    freeTier: {
      billing: "user",
      limit: FREE_CHAT_TURNS_LIMIT,
      paidSource: "balance",
      remaining: 0,
      wall: "balance",
    },
    interruption: null,
  },
};

export function useChatBillingCardFreeTierOverride(): ChatBillingCardOverride | null {
  const values = useDevTweaks("Chat · billing card", CHAT_BILLING_CARD_TWEAKS, {
    id: "chat-billing-card",
    persist: { storage: "sessionStorage" },
  });
  if (!(TWEAKABLE_BUILD && values.override)) {
    return null;
  }
  const fixed = FIXED_POSTURES[values.posture];
  if (fixed != null) {
    return fixed;
  }
  const remaining = Math.min(
    FREE_CHAT_TURNS_LIMIT,
    Math.max(1, Math.round(values.remaining))
  );
  return {
    freeTier: {
      billing: "free",
      limit: FREE_CHAT_TURNS_LIMIT,
      paidSource: null,
      remaining,
      wall: null,
    },
    interruption: null,
  };
}
