"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { cn } from "@workspace/ui/lib/utils";
import { Gift, TriangleAlert } from "lucide-react";

import { BillingCalloutCard } from "@/features/billing/billing-callout-card";

import {
  type ChatBillingCopy,
  type ChatBillingInterruption,
  chatBillingInterruptionCopy,
  chatBillingWallCopy,
} from "./chat-billing-interruption";
import type { ChatWallCause, FreeTierState } from "./persistence/types";

export type ChatBillingCard = "billing-error" | "counter" | "error" | "wall";

/**
 * Where a chat billing CTA lands: `upgrade` deep-links the Plan Picker open
 * (`/billing?mode=upgrade`, the App Sidebar precedent), `plans` lands on the
 * Plan view without opening it, and `top-up` leaves for the Sealos Desktop
 * cost center — the one place a top-up exists — falling back to the Plan
 * view while the desktop link is unresolved.
 */
export type ChatBillingDestination = "plans" | "top-up" | "upgrade";

/**
 * Card-slot arbitration for the Project Assistant Pane (ADR-0069, design
 * spec row E3): exactly one card renders at a time, wall > billing-error >
 * error > counter. The paid wall outranks every error card because "try
 * again" is a lie once the server refuses chat; a billing interruption
 * outranks the generic error because it knows why. On open `user` billing
 * only an error card can ever show. Every wall cause locks alike — an
 * allowance cause (ADR-0073) as immediately as an exhausted Paid Source.
 */
export function resolveChatBillingCard(input: {
  billing: FreeTierState["billing"] | null;
  errored: boolean;
  interruption?: ChatBillingInterruption | null;
  wall?: ChatWallCause | null;
}): ChatBillingCard | null {
  if (input.wall != null) {
    return "wall";
  }
  if (input.errored) {
    return input.interruption == null ? "error" : "billing-error";
  }
  return input.billing === "free" ? "counter" : null;
}

function GiftTile() {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-input/40 text-muted-foreground">
      <Gift aria-hidden className="size-4" strokeWidth={1.75} />
    </div>
  );
}

function RemainingPips({
  limit,
  remaining,
}: {
  limit: number;
  remaining: number;
}) {
  return (
    <div
      aria-label="Free trial messages remaining"
      aria-valuemax={limit}
      aria-valuemin={0}
      aria-valuenow={remaining}
      aria-valuetext={`${remaining} of ${limit} left`}
      className="flex items-center gap-1"
      role="progressbar"
    >
      {Array.from({ length: limit }, (_, index) => (
        <span
          className={cn(
            "size-1.5 rounded-full",
            index < remaining ? "bg-primary" : "bg-input"
          )}
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size static pips
          key={index}
        />
      ))}
    </div>
  );
}

function CounterCard({
  freeTier,
  onNavigateToBilling,
}: {
  freeTier: FreeTierState;
  onNavigateToBilling: (destination: ChatBillingDestination) => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-border/35 bg-input/20 p-3"
      data-slot="chat-free-counter-card"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <GiftTile />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-muted-foreground text-xs">
            {freeTier.remaining} of {freeTier.limit} free trial messages left
          </p>
          <RemainingPips
            limit={freeTier.limit}
            remaining={freeTier.remaining}
          />
        </div>
      </div>
      <AppButton
        onClick={() => onNavigateToBilling("plans")}
        size="sm"
        variant="quiet"
      >
        View plans
      </AppButton>
    </div>
  );
}

/**
 * The paid wall (design spec row E3), the loud sibling of the quiet Free
 * Chat Turns card: a destructive tint marks a hard stop the pre-send gate
 * caught, and the CTA names the fix the Chat Billing Mode calls for.
 */
function PaidWallCard({
  copy,
  onNavigateToBilling,
}: {
  copy: ChatBillingCopy;
  onNavigateToBilling: (destination: ChatBillingDestination) => void;
}) {
  return (
    <BillingCalloutCard
      action={
        <AppButton
          onClick={() => onNavigateToBilling(copy.cta.destination)}
          size="sm"
          variant="chip"
        >
          {copy.cta.label}
        </AppButton>
      }
      body={copy.body}
      className="rounded-xl p-3"
      data-slot="chat-paid-wall-card"
      icon={TriangleAlert}
      layout="inline"
      title={copy.title}
    />
  );
}

/**
 * The error card once the failed turn is known to be a billing refusal: the
 * error frame stays, the copy tells the truth and offers the fix. It locks
 * nothing — the next send re-gates, and the lock lives in exactly one place.
 */
function BillingErrorCard({
  copy,
  onNavigateToBilling,
}: {
  copy: ChatBillingCopy;
  onNavigateToBilling: (destination: ChatBillingDestination) => void;
}) {
  return (
    <BillingCalloutCard
      action={
        <AppButton
          onClick={() => onNavigateToBilling(copy.cta.destination)}
          size="sm"
          variant="chip"
        >
          {copy.cta.label}
        </AppButton>
      }
      body={copy.body}
      className="rounded-xl p-3"
      data-slot="chat-billing-error-card"
      icon={TriangleAlert}
      layout="inline"
      title={copy.title}
    />
  );
}

function ErrorCard() {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3"
      data-slot="chat-error-card"
      role="alert"
    >
      <TriangleAlert
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium text-foreground text-sm">Message not sent</p>
        <p className="text-muted-foreground text-xs">
          Something went wrong on our side. Try sending it again.
        </p>
      </div>
    </div>
  );
}

/**
 * The Project Assistant Pane's billing card slot between transcript and
 * composer. Steady-state `user` billing renders nothing at all — paying is
 * the ambient baseline, and the generic error card carries zero billing
 * markings; only a refusal the server classified as billing speaks money.
 */
export function ChatBillingCardSlot({
  errored,
  freeTier,
  interruption = null,
  onNavigateToBilling,
}: {
  errored: boolean;
  freeTier: FreeTierState | null;
  /** The billing refusal behind the current error, when the pane knows one. */
  interruption?: ChatBillingInterruption | null;
  /**
   * Every CTA is a full-page navigation into the Billing Area: `upgrade`
   * deep-links the Plan Picker open, `plans` lands on the Plan view.
   */
  onNavigateToBilling: (destination: ChatBillingDestination) => void;
}) {
  const wall = freeTier?.wall ?? null;
  const card = resolveChatBillingCard({
    billing: freeTier?.billing ?? null,
    errored,
    interruption,
    wall,
  });
  if (card == null) {
    return null;
  }
  return (
    <div className="shrink-0 px-2.5 pt-1">
      {card === "wall" && wall != null ? (
        <PaidWallCard
          copy={chatBillingWallCopy(wall)}
          onNavigateToBilling={onNavigateToBilling}
        />
      ) : null}
      {card === "billing-error" ? (
        <BillingErrorCard
          copy={chatBillingInterruptionCopy(interruption?.paidSource ?? null)}
          onNavigateToBilling={onNavigateToBilling}
        />
      ) : null}
      {card === "error" ? <ErrorCard /> : null}
      {card === "counter" && freeTier != null ? (
        <CounterCard
          freeTier={freeTier}
          onNavigateToBilling={onNavigateToBilling}
        />
      ) : null}
    </div>
  );
}
