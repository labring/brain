"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { cn } from "@workspace/ui/lib/utils";
import { Gift, TriangleAlert } from "lucide-react";

import type { FreeTierState } from "./persistence/types";

export type ChatBillingCard = "blocked" | "counter" | "error";

/**
 * Where a chat billing CTA lands in the Billing Area: `upgrade` deep-links
 * the Plan Picker open (`/billing?mode=upgrade`, the App Sidebar precedent),
 * `plans` lands on the Plan view without opening it.
 */
export type ChatBillingDestination = "plans" | "upgrade";

/**
 * Card-slot arbitration for the Project Assistant Pane (ADR-0065): exactly
 * one card renders at a time, blocked > error > counter. `blocked` outranks
 * the error card because "try again" is a lie once the server refuses chat;
 * on `user` billing the error card is the only card that can ever show.
 */
export function resolveChatBillingCard(input: {
  billing: FreeTierState["billing"] | null;
  errored: boolean;
}): ChatBillingCard | null {
  if (input.billing === "blocked") {
    return "blocked";
  }
  if (input.errored) {
    return "error";
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

function BlockedCard({
  onNavigateToBilling,
}: {
  onNavigateToBilling: (destination: ChatBillingDestination) => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-border/35 bg-input/20 p-3"
      data-slot="chat-blocked-card"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <GiftTile />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium text-foreground text-xs">
            Free trial messages used up
          </p>
          <p className="text-muted-foreground text-xs">
            Upgrade to keep chatting with the assistant.
          </p>
        </div>
      </div>
      <AppButton onClick={() => onNavigateToBilling("upgrade")} size="sm">
        Upgrade plan
      </AppButton>
    </div>
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
 * the ambient baseline, and the error card carries zero billing markings.
 */
export function ChatBillingCardSlot({
  errored,
  freeTier,
  onNavigateToBilling,
}: {
  errored: boolean;
  freeTier: FreeTierState | null;
  /**
   * Both CTAs are full-page navigations into the Billing Area: the blocked
   * card's "Upgrade plan" deep-links the Plan Picker open (`upgrade`), the
   * counter's "View plans" lands on the Plan view (`plans`).
   */
  onNavigateToBilling: (destination: ChatBillingDestination) => void;
}) {
  const card = resolveChatBillingCard({
    billing: freeTier?.billing ?? null,
    errored,
  });
  if (card == null) {
    return null;
  }
  return (
    <div className="shrink-0 px-2.5 pt-1">
      {card === "blocked" ? (
        <BlockedCard onNavigateToBilling={onNavigateToBilling} />
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
