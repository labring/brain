"use client";

import { type DevTweaksConfig, useDevTweaks } from "@workspace/dev-tweaks";

import type { FreeTierState } from "./persistence/types";

// Mirrors DEFAULT_FREE_CHAT_TURNS (persistence/free-tier.ts): the counter
// card draws `limit` pips, so the slider range tracks the real allowance.
const FREE_CHAT_TURNS_LIMIT = 5;

/**
 * Every posture but the counter fabricates one fixed state; the counter
 * follows the slider. Declared apart so `FIXED_POSTURES` is keyed by these
 * values and a typo in either place is a type error, not a silent fall
 * through to the counter.
 */
const FIXED_POSTURE_OPTIONS = [
  { label: "0 turns — handoff (renders nothing)", value: "handoff" },
  { label: "Allowance wall — after trial", value: "allowance-wall-trial" },
  { label: "Allowance wall — plan without AI", value: "allowance-wall-plan" },
  { label: "Paid wall — AI Credits", value: "wall-ai-credits" },
  { label: "Paid wall — balance", value: "wall-balance" },
] as const satisfies readonly { label: string; value: string }[];

type FixedChatBillingCardPosture =
  (typeof FIXED_POSTURE_OPTIONS)[number]["value"];

const CHAT_BILLING_CARD_TWEAKS = {
  override: false,
  posture: {
    default: "counter",
    options: [
      { label: "Counter (free turns)", value: "counter" },
      ...FIXED_POSTURE_OPTIONS,
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
 * the counter card at 1–5 pips (the slider), the true 0-free-turns handoff
 * (which deliberately renders NOTHING: an open composer on `user` billing,
 * ADR-0069 — pick a wall posture to see a card), or the Paid Chat Wall in
 * any of its causes: the allowance causes (ADR-0073: a plan without an AI
 * allowance, voiced for after the trial or for the plan itself) and the
 * two Paid Source voices. Every wall locks the composer. The wall is its
 * own option rather than the slider's zero because real remaining=0 shows
 * no wall by itself. A tweak, not a Dev Mock, and deliberately
 * chat-pane-only: the server, the sidebar's free-turns row, and the Plan
 * view keep their real state (the billing Dev Mock's `/api/chat/free-turns`
 * fixture covers those), so ADR-0065's server-computed posture is only ever
 * overridden where the dev tweaks panel exists.
 */
const FIXED_POSTURES: Record<FixedChatBillingCardPosture, FreeTierState> = {
  "allowance-wall-plan": {
    billing: "user",
    limit: FREE_CHAT_TURNS_LIMIT,
    paidSource: "ai-credits",
    remaining: FREE_CHAT_TURNS_LIMIT,
    wall: "allowance-plan",
  },
  "allowance-wall-trial": {
    billing: "user",
    limit: FREE_CHAT_TURNS_LIMIT,
    paidSource: "ai-credits",
    remaining: 0,
    wall: "allowance-trial",
  },
  handoff: {
    billing: "user",
    limit: FREE_CHAT_TURNS_LIMIT,
    paidSource: null,
    remaining: 0,
    wall: null,
  },
  "wall-ai-credits": {
    billing: "user",
    limit: FREE_CHAT_TURNS_LIMIT,
    paidSource: "ai-credits",
    remaining: 0,
    wall: "ai-credits",
  },
  "wall-balance": {
    billing: "user",
    limit: FREE_CHAT_TURNS_LIMIT,
    paidSource: "balance",
    remaining: 0,
    wall: "balance",
  },
};

/**
 * The select's value is a plain string, and a session may still carry a
 * posture an earlier build offered; anything not in the table is the
 * counter.
 */
function isFixedPosture(value: string): value is FixedChatBillingCardPosture {
  return Object.hasOwn(FIXED_POSTURES, value);
}

export function useChatBillingCardFreeTierOverride(): FreeTierState | null {
  const values = useDevTweaks("Chat · billing card", CHAT_BILLING_CARD_TWEAKS, {
    id: "chat-billing-card",
    persist: { storage: "sessionStorage" },
  });
  if (!(TWEAKABLE_BUILD && values.override)) {
    return null;
  }
  if (isFixedPosture(values.posture)) {
    return FIXED_POSTURES[values.posture];
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
