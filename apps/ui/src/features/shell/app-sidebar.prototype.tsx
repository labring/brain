"use client";

// PROTOTYPE — throwaway UI exploration, not production code.
//
// Round 4: workspace-switcher exploration is parked; the prototype now only
// touches the FOOTER — a quota/plan card above the Billing and Back to
// Desktop rows, and an account row at the bottom. The header and nav are the
// shipped sidebar, untouched.
//
//   0  Current   — the sidebar as it ships today (control)
//   1  Card      — static "Resources" card, never folds
//   2  Fold      — click header to fold; closed = title + peak % only
//   3  Strip     — foldable; closed keeps a 5-segment usage strip
//   4  MiniBars  — foldable; closed keeps three hairline bars (CPU/Mem/Sto)
//   5  Hover     — closed card that expands while hovered, no click needed
//   6  Smart     — folds itself; auto-opens when a quota crosses 80%
//   7  Plan      — the card is titled "Plan": badge + status hint + usage
//   8  PlanFold  — same Plan card but foldable; closed = title + badge + hint
//   9  Account   — no card at all: the account row carries the plan badge and
//                  clicking it opens a popover with usage + identity + upgrade
//
// Footer order: card, Billing, Back to Desktop, account row. Switch with the
// floating bar (or ←/→); the state button cycles mock subscription states
// (visible in variants 7/8). URL params `variant` and `pstate` share a combo.
// All data is mocked; nothing fetches. Gated out of production builds.

import { AppButton } from "@workspace/ui/components/app-button";
import { PlanBadge } from "@workspace/ui/components/plan-badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { useSidebar } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { atom, useAtom, useAtomValue } from "jotai";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  CreditCard,
  Gauge,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";
import {
  AppSidebarDesktopReturn,
  AppSidebarNavRow,
} from "@/features/shell/app-sidebar";

const PROTO_ENABLED = process.env.NODE_ENV !== "production";

// ---------------------------------------------------------------------------
// Mock data

const PROTO_USER = { id: "usr-Kx92mQ", name: "aimerite", nsid: "ns-b0j3q1x" };

interface ProtoQuotaRow {
  label: string;
  percent: number;
  value: string;
}

const PROTO_QUOTA: ProtoQuotaRow[] = [
  { label: "CPU", percent: 48, value: "1.9 / 4 C" },
  { label: "Memory", percent: 82, value: "6.6 / 8 G" },
  { label: "Storage", percent: 24, value: "12 / 50 G" },
  { label: "Pods", percent: 44, value: "14 / 32" },
  { label: "Ports", percent: 38, value: "3 / 8" },
];

const PROTO_QUOTA_PEAK = PROTO_QUOTA.reduce(
  (worst, row) => (row.percent > worst.percent ? row : worst),
  PROTO_QUOTA[0] ?? { label: "CPU", percent: 0, value: "" }
);

type ProtoTone = "danger" | "muted" | "warn";

interface ProtoPlanState {
  hint: string;
  key: string;
  label: string;
  planName: string | null;
  tone: ProtoTone;
}

const PROTO_PLAN_STATE_DEFAULT: ProtoPlanState = {
  hint: "Renews Sep 12",
  key: "pro",
  label: "PRO · active",
  planName: "PRO",
  tone: "muted",
};

const PROTO_PLAN_STATES: ProtoPlanState[] = [
  PROTO_PLAN_STATE_DEFAULT,
  {
    hint: "Trial · 3 days left",
    key: "trial",
    label: "FREE · trial",
    planName: "FREE",
    tone: "warn",
  },
  {
    hint: "Usage-billed",
    key: "payg",
    label: "PAYG",
    planName: null,
    tone: "muted",
  },
  {
    hint: "Payment due · service limited",
    key: "debt",
    label: "PRO · payment due",
    planName: "PRO",
    tone: "danger",
  },
  {
    hint: "Ends Sep 12",
    key: "cancelling",
    label: "TEAM · cancelling",
    planName: "TEAM",
    tone: "warn",
  },
];

const PROTO_VARIANTS = [
  { key: "0", name: "Current" },
  { key: "1", name: "Card" },
  { key: "2", name: "Fold" },
  { key: "3", name: "Strip" },
  { key: "4", name: "MiniBars" },
  { key: "5", name: "Hover" },
  { key: "6", name: "Smart" },
  { key: "7", name: "Plan" },
  { key: "8", name: "PlanFold" },
  { key: "9", name: "Account" },
] as const;

type ProtoVariantKey = (typeof PROTO_VARIANTS)[number]["key"];

// ---------------------------------------------------------------------------
// Shared state (module-level atoms survive layout remounts across routes)

const protoVariantAtom = atom<ProtoVariantKey>("0");
const protoPlanStateAtom = atom(0);

function syncProtoUrl(variant: string, stateIndex: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", variant);
  url.searchParams.set("pstate", PROTO_PLAN_STATES[stateIndex]?.key ?? "pro");
  window.history.replaceState(null, "", url.toString());
}

export function useAppSidebarPrototypeVariant(): ProtoVariantKey {
  const variant = useAtomValue(protoVariantAtom);
  return PROTO_ENABLED ? variant : "0";
}

function useProtoPlanState(): ProtoPlanState {
  const index = useAtomValue(protoPlanStateAtom);
  return PROTO_PLAN_STATES[index] ?? PROTO_PLAN_STATE_DEFAULT;
}

// ---------------------------------------------------------------------------
// Shared building blocks

function ProtoUserAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-400 to-blue-600 font-medium text-[10px] text-white",
        className
      )}
    >
      {PROTO_USER.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ProtoBar({
  className,
  percent,
}: {
  className?: string;
  percent: number;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "block h-1 w-full overflow-hidden rounded-full bg-input/50",
        className
      )}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          percent >= 80 ? "bg-amber-400" : "bg-blue-400"
        )}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </span>
  );
}

function useProtoCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, []);
  return [copied, copy];
}

/** Avatar + name, second line toggles between user ID and NS with copy. */
function ProtoAccountRow() {
  const [showNs, setShowNs] = useState(false);
  const [copied, copy] = useProtoCopy();
  const identity = showNs ? PROTO_USER.nsid : PROTO_USER.id;

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-input/30">
      <ProtoUserAvatar className="size-6" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-neutral-50 text-sm/4">
          {PROTO_USER.name}
        </div>
        <button
          className="flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-neutral-50"
          onClick={() => setShowNs((v) => !v)}
          type="button"
        >
          <span className="truncate tabular-nums">
            {showNs ? "NS" : "ID"}: {identity}
          </span>
        </button>
      </div>
      <button
        aria-label="Copy identity"
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-neutral-50"
        onClick={() => copy(identity)}
        type="button"
      >
        {copied ? (
          <Check aria-hidden className="size-3.5" strokeWidth={1.8} />
        ) : (
          <Copy aria-hidden className="size-3.5" strokeWidth={1.8} />
        )}
      </button>
    </div>
  );
}

/** Collapsed-rail account: avatar button opening a side popover. */
function ProtoAccountRailButton() {
  const [copied, copy] = useProtoCopy();
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label={PROTO_USER.name}
            className="flex h-8 w-9 items-center justify-center rounded-md transition-colors hover:bg-input/30"
            type="button"
          />
        }
      >
        <ProtoUserAvatar className="size-6" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-56 gap-0 rounded-lg border border-border bg-input/30 p-3 text-brand-primary-foreground shadow-none ring-0 backdrop-blur-xl"
        side="right"
        sideOffset={6}
      >
        <div className="flex items-center gap-2">
          <ProtoUserAvatar className="size-8" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-sm">
              {PROTO_USER.name}
            </div>
            <div className="truncate text-muted-foreground text-xs tabular-nums">
              ID: {PROTO_USER.id}
            </div>
          </div>
          <button
            aria-label="Copy identity"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-neutral-50"
            onClick={() => copy(PROTO_USER.id)}
            type="button"
          >
            {copied ? (
              <Check aria-hidden className="size-3.5" strokeWidth={1.8} />
            ) : (
              <Copy aria-hidden className="size-3.5" strokeWidth={1.8} />
            )}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProtoUpgradeButton() {
  return (
    <AppButton
      className="w-full"
      nativeButton={false}
      render={
        <Link href="/billing?mode=upgrade" onClick={recordBillingReturnRoute} />
      }
      variant="secondary"
    >
      <Sparkles
        aria-hidden
        className="size-4"
        data-icon="inline-start"
        strokeWidth={1.75}
      />
      <span>Upgrade</span>
    </AppButton>
  );
}

/** Full quota details, used by the collapsed rail and the Meter variant. */
function ProtoQuotaPopoverContent() {
  return (
    <PopoverContent
      align="start"
      className="w-60 gap-0 rounded-lg border border-border bg-input/30 p-4 text-brand-primary-foreground shadow-none ring-0 backdrop-blur-xl"
      side="right"
      sideOffset={6}
    >
      <div className="flex flex-col gap-3">
        <span className="font-medium text-sm">Resources</span>
        <div className="flex flex-col gap-2">
          {PROTO_QUOTA.map((row) => (
            <div className="flex flex-col gap-1" key={row.label}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="tabular-nums">{row.value}</span>
              </div>
              <ProtoBar percent={row.percent} />
            </div>
          ))}
        </div>
        <ProtoUpgradeButton />
      </div>
    </PopoverContent>
  );
}

/** Collapsed-rail quota entry shared by all usage variants. */
function ProtoQuotaRailButton() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label="Resources"
            className="flex h-8 w-9 items-center justify-center rounded-md transition-colors hover:bg-input/30"
            type="button"
          />
        }
      >
        <Gauge
          aria-hidden
          className="size-4 text-neutral-50"
          strokeWidth={1.8}
        />
      </PopoverTrigger>
      <ProtoQuotaPopoverContent />
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Plan-state presentation

const PROTO_HINT_TEXT: Record<ProtoTone, string> = {
  danger: "text-red-400",
  muted: "text-muted-foreground",
  warn: "text-amber-400",
};

// ---------------------------------------------------------------------------
// Card family shared pieces

function ProtoCardShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-input/20 p-2.5",
        className
      )}
    >
      {children}
    </div>
  );
}

function ProtoCardPeak() {
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        PROTO_QUOTA_PEAK.percent >= 80
          ? "text-amber-400"
          : "text-muted-foreground"
      )}
    >
      {PROTO_QUOTA_PEAK.percent}%
    </span>
  );
}

/** The open card body: all five rows + the inline upgrade pill. */
function ProtoCardDetails() {
  return (
    <div className="flex flex-col gap-2.5 pt-2.5">
      <div className="flex flex-col gap-1.5">
        {PROTO_QUOTA.map((row) => (
          <div className="flex items-center gap-2" key={row.label}>
            <span className="w-12 shrink-0 text-muted-foreground text-xs">
              {row.label}
            </span>
            <ProtoBar className="flex-1" percent={row.percent} />
            <span className="w-14 shrink-0 text-right text-neutral-50 text-xs tabular-nums">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <Link
        className="flex items-center justify-center gap-1.5 rounded-md bg-input/40 py-1.5 font-medium text-neutral-50 text-xs transition-colors hover:bg-input/60"
        href="/billing?mode=upgrade"
        onClick={recordBillingReturnRoute}
      >
        <Sparkles aria-hidden className="size-3.5" strokeWidth={1.75} />
        Upgrade
      </Link>
    </div>
  );
}

function ProtoCardFoldHeader({
  children,
  onToggle,
  open,
}: {
  children?: ReactNode;
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <button
      aria-expanded={open}
      className="-m-1 flex items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-input/30"
      onClick={onToggle}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate font-medium text-neutral-50 text-sm">
        Resources
      </span>
      {children ?? <ProtoCardPeak />}
      <ChevronDown
        aria-hidden
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-180"
        )}
        strokeWidth={1.8}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Variant 1 — "Card": static card, never folds (round-2 baseline)

function ProtoUsageCardStatic() {
  return (
    <ProtoCardShell>
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-neutral-50 text-sm">Resources</span>
        <ProtoCardPeak />
      </div>
      <ProtoCardDetails />
    </ProtoCardShell>
  );
}

// ---------------------------------------------------------------------------
// Variant 2 — "Fold": click to fold; closed = title + peak % only

function ProtoUsageCardFold() {
  const [open, setOpen] = useState(false);
  return (
    <ProtoCardShell>
      <ProtoCardFoldHeader onToggle={() => setOpen((v) => !v)} open={open} />
      {open ? <ProtoCardDetails /> : null}
    </ProtoCardShell>
  );
}

// ---------------------------------------------------------------------------
// Variant 3 — "Strip": foldable; closed keeps a 5-segment usage strip

function ProtoUsageCardStrip() {
  const [open, setOpen] = useState(false);
  return (
    <ProtoCardShell>
      <ProtoCardFoldHeader onToggle={() => setOpen((v) => !v)} open={open} />
      {open ? (
        <ProtoCardDetails />
      ) : (
        <div
          className="flex gap-0.5 pt-2"
          title="CPU · Memory · Storage · Pods · Ports"
        >
          {PROTO_QUOTA.map((row) => (
            <span
              className="block h-1 flex-1 overflow-hidden rounded-full bg-input/50"
              key={row.label}
            >
              <span
                className={cn(
                  "block h-full rounded-full",
                  row.percent >= 80 ? "bg-amber-400" : "bg-blue-400"
                )}
                style={{ width: `${Math.min(100, row.percent)}%` }}
              />
            </span>
          ))}
        </div>
      )}
    </ProtoCardShell>
  );
}

// ---------------------------------------------------------------------------
// Variant 4 — "MiniBars": foldable; closed keeps three hairline bars

function ProtoUsageCardMiniBars() {
  const [open, setOpen] = useState(false);
  return (
    <ProtoCardShell>
      <ProtoCardFoldHeader onToggle={() => setOpen((v) => !v)} open={open} />
      {open ? (
        <ProtoCardDetails />
      ) : (
        <div className="flex flex-col gap-1 pt-2">
          {PROTO_QUOTA.slice(0, 3).map((row) => (
            <div className="flex items-center gap-2" key={row.label}>
              <span className="w-7 shrink-0 text-[10px] text-muted-foreground">
                {row.label === "Memory" ? "Mem" : row.label.slice(0, 3)}
              </span>
              <ProtoBar className="h-0.5 flex-1" percent={row.percent} />
            </div>
          ))}
        </div>
      )}
    </ProtoCardShell>
  );
}

// ---------------------------------------------------------------------------
// Variant 5 — "Hover": closed card that expands while hovered

function ProtoUsageCardHover() {
  return (
    <ProtoCardShell className="group/usage">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-neutral-50 text-sm">
          Resources
        </span>
        <ProtoCardPeak />
      </div>
      <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-out group-hover/usage:grid-rows-[1fr] motion-reduce:transition-none">
        <div className="overflow-hidden">
          <ProtoCardDetails />
        </div>
      </div>
    </ProtoCardShell>
  );
}

// ---------------------------------------------------------------------------
// Variant 6 — "Smart": folds itself; auto-opens when a quota crosses 80%

function ProtoUsageCardSmart() {
  // null = automatic (open while something is over the threshold).
  const [manual, setManual] = useState<boolean | null>(null);
  const hasOffender = PROTO_QUOTA.some((row) => row.percent >= 80);
  const open = manual ?? hasOffender;
  return (
    <ProtoCardShell>
      <ProtoCardFoldHeader
        onToggle={() => setManual(open ? false : null)}
        open={open}
      >
        {hasOffender ? (
          <span className="flex items-center gap-1 text-amber-400 text-xs">
            <TriangleAlert aria-hidden className="size-3" strokeWidth={1.8} />
            {PROTO_QUOTA_PEAK.label} {PROTO_QUOTA_PEAK.percent}%
          </span>
        ) : (
          <ProtoCardPeak />
        )}
      </ProtoCardFoldHeader>
      {open ? <ProtoCardDetails /> : null}
    </ProtoCardShell>
  );
}

// ---------------------------------------------------------------------------
// Variants 7/8 — the card IS the Plan: badge + status hint + usage + upgrade

function ProtoPlanBadgeSlot() {
  const plan = useProtoPlanState();
  if (plan.planName == null) {
    return <span className="text-muted-foreground text-xs">PAYG</span>;
  }
  return <PlanBadge className="h-4 text-xs" planName={plan.planName} />;
}

function ProtoPlanHint() {
  const plan = useProtoPlanState();
  return (
    <div className={cn("text-xs", PROTO_HINT_TEXT[plan.tone])}>{plan.hint}</div>
  );
}

function ProtoUsagePlanCard() {
  return (
    <ProtoCardShell>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-neutral-50 text-sm">Plan</span>
        <ProtoPlanBadgeSlot />
      </div>
      <div className="pt-1">
        <ProtoPlanHint />
      </div>
      <ProtoCardDetails />
    </ProtoCardShell>
  );
}

function ProtoUsagePlanCardFold() {
  const [open, setOpen] = useState(false);
  return (
    <ProtoCardShell>
      <button
        aria-expanded={open}
        className="-m-1 flex items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-input/30"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate font-medium text-neutral-50 text-sm">
          Plan
        </span>
        <ProtoPlanBadgeSlot />
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          strokeWidth={1.8}
        />
      </button>
      <div className="pt-1.5">
        <ProtoPlanHint />
      </div>
      {open ? <ProtoCardDetails /> : null}
    </ProtoCardShell>
  );
}

// ---------------------------------------------------------------------------
// Variant 9 — "Account": the account row is the single entry point

function ProtoAccountPopoverContent({ side }: { side: "right" | "top" }) {
  const [copied, copy] = useProtoCopy();
  const plan = useProtoPlanState();
  return (
    <PopoverContent
      align={side === "top" ? "start" : "end"}
      className="w-52 gap-0 rounded-lg border border-border bg-input/30 p-3 text-brand-primary-foreground shadow-none ring-0 backdrop-blur-xl"
      side={side}
      sideOffset={6}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <ProtoUserAvatar className="size-6" />
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            {PROTO_USER.name}
          </span>
          <ProtoPlanBadgeSlot />
        </div>
        <button
          className="flex items-center gap-1 text-muted-foreground text-xs tabular-nums transition-colors hover:text-neutral-50"
          onClick={() => copy(PROTO_USER.id)}
          type="button"
        >
          ID: {PROTO_USER.id}
          {copied ? (
            <Check aria-hidden className="size-3" strokeWidth={1.8} />
          ) : (
            <Copy aria-hidden className="size-3" strokeWidth={1.8} />
          )}
        </button>
        {plan.tone === "muted" ? null : <ProtoPlanHint />}
        <div className="h-px w-full bg-border" />
        <div className="flex flex-col gap-1.5">
          {PROTO_QUOTA.map((row) => (
            <div className="flex items-center gap-2" key={row.label}>
              <span className="w-10 shrink-0 text-muted-foreground text-xs">
                {row.label === "Memory" ? "Mem" : row.label}
              </span>
              <ProtoBar className="flex-1" percent={row.percent} />
              <span className="w-14 shrink-0 text-right text-xs tabular-nums">
                {row.value}
              </span>
            </div>
          ))}
        </div>
        <Link
          className="flex items-center justify-center gap-1.5 rounded-md bg-input/40 py-1 font-medium text-neutral-50 text-xs transition-colors hover:bg-input/60"
          href="/billing?mode=upgrade"
          onClick={recordBillingReturnRoute}
        >
          <Sparkles aria-hidden className="size-3.5" strokeWidth={1.75} />
          Upgrade
        </Link>
      </div>
    </PopoverContent>
  );
}

function ProtoAccountPlanRow() {
  const plan = useProtoPlanState();
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label={`Account: ${PROTO_USER.name}`}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-input/30"
            type="button"
          />
        }
      >
        <ProtoUserAvatar className="size-6" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-neutral-50 text-sm/4">
            {PROTO_USER.name}
          </div>
          <div
            className={cn(
              "truncate text-xs",
              plan.tone === "muted"
                ? "text-muted-foreground"
                : PROTO_HINT_TEXT[plan.tone]
            )}
          >
            {plan.tone === "muted" ? `ID: ${PROTO_USER.id}` : plan.hint}
          </div>
        </div>
        <ProtoPlanBadgeSlot />
      </PopoverTrigger>
      <ProtoAccountPopoverContent side="top" />
    </Popover>
  );
}

function ProtoAccountPlanRailButton() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label={`Account: ${PROTO_USER.name}`}
            className="flex h-8 w-9 items-center justify-center rounded-md transition-colors hover:bg-input/30"
            type="button"
          />
        }
      >
        <ProtoUserAvatar className="size-6" />
      </PopoverTrigger>
      <ProtoAccountPopoverContent side="right" />
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Slots mounted by AppSidebarChrome

function ProtoUsageSlot({ variant }: { variant: ProtoVariantKey }) {
  switch (variant) {
    case "1":
      return <ProtoUsageCardStatic />;
    case "2":
      return <ProtoUsageCardFold />;
    case "3":
      return <ProtoUsageCardStrip />;
    case "4":
      return <ProtoUsageCardMiniBars />;
    case "5":
      return <ProtoUsageCardHover />;
    case "6":
      return <ProtoUsageCardSmart />;
    case "7":
      return <ProtoUsagePlanCard />;
    case "8":
      return <ProtoUsagePlanCardFold />;
    default:
      return null;
  }
}

export function AppSidebarPrototypeFooter({
  billingActive,
  variant,
}: {
  billingActive: boolean;
  variant: ProtoVariantKey;
}) {
  const { state } = useSidebar();
  const expanded = state === "expanded";

  const accountOnly = variant === "9";
  const usageSlot = expanded ? (
    <ProtoUsageSlot variant={variant} />
  ) : (
    <ProtoQuotaRailButton />
  );
  const accountSlot = expanded ? (
    <ProtoAccountRow />
  ) : (
    <ProtoAccountRailButton />
  );
  const accountPlanSlot = expanded ? (
    <ProtoAccountPlanRow />
  ) : (
    <ProtoAccountPlanRailButton />
  );

  return (
    <div className="flex shrink-0 flex-col gap-2 pt-3">
      {accountOnly ? null : usageSlot}
      <AppSidebarNavRow
        active={billingActive}
        href="/billing"
        icon={<CreditCard aria-hidden className="size-4" strokeWidth={1.8} />}
        label="Billing"
        onClick={recordBillingReturnRoute}
      />
      <AppSidebarDesktopReturn />
      {accountOnly ? accountPlanSlot : accountSlot}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating switcher bar (mounted once in AppSidebarShell)

export function AppSidebarPrototypeBar() {
  const [variant, setVariant] = useAtom(protoVariantAtom);
  const [stateIndex, setStateIndex] = useAtom(protoPlanStateAtom);

  // Hydrate from the URL once so a shared link lands on the same combination.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlVariant = params.get("variant");
    if (urlVariant && PROTO_VARIANTS.some((v) => v.key === urlVariant)) {
      setVariant(urlVariant as ProtoVariantKey);
    }
    const urlState = params.get("pstate");
    const index = PROTO_PLAN_STATES.findIndex((s) => s.key === urlState);
    if (index >= 0) {
      setStateIndex(index);
    }
  }, [setStateIndex, setVariant]);

  const step = useCallback(
    (delta: number) => {
      const index = PROTO_VARIANTS.findIndex((v) => v.key === variant);
      const next =
        PROTO_VARIANTS[
          (index + delta + PROTO_VARIANTS.length) % PROTO_VARIANTS.length
        ];
      if (next == null) {
        return;
      }
      setVariant(next.key);
      syncProtoUrl(next.key, stateIndex);
    },
    [setVariant, stateIndex, variant]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target != null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        step(-1);
      } else if (event.key === "ArrowRight") {
        step(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step]);

  if (!PROTO_ENABLED) {
    return null;
  }

  const current = PROTO_VARIANTS.find((v) => v.key === variant);
  const planState = PROTO_PLAN_STATES[stateIndex] ?? PROTO_PLAN_STATE_DEFAULT;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-neutral-900/95 py-1 pr-2 pl-1 text-neutral-50 text-xs shadow-lg">
      <button
        aria-label="Previous variant"
        className="rounded-full p-1.5 transition-colors hover:bg-input/40"
        onClick={() => step(-1)}
        type="button"
      >
        <ChevronLeft aria-hidden className="size-3.5" strokeWidth={2} />
      </button>
      <span className="min-w-24 text-center font-medium tabular-nums">
        {variant} · {current?.name}
      </span>
      <button
        aria-label="Next variant"
        className="rounded-full p-1.5 transition-colors hover:bg-input/40"
        onClick={() => step(1)}
        type="button"
      >
        <ChevronRight aria-hidden className="size-3.5" strokeWidth={2} />
      </button>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      <button
        className="rounded-full px-2 py-1 text-muted-foreground transition-colors hover:bg-input/40 hover:text-neutral-50"
        onClick={() => {
          const next = (stateIndex + 1) % PROTO_PLAN_STATES.length;
          setStateIndex(next);
          syncProtoUrl(variant, next);
        }}
        type="button"
      >
        {planState.label}
      </button>
    </div>
  );
}
