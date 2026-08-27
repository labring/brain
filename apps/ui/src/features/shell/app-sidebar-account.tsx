"use client";

import { PlanBadge } from "@workspace/ui/components/plan-badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { useSidebar } from "@workspace/ui/components/sidebar";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  CreditCard,
  Gauge,
  House,
  Sparkles,
  User,
} from "lucide-react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR from "swr";
import { loadAiCredits } from "@/features/billing/billing-ai-credits";
import {
  loadWorkspaceSubscriptionSummary,
  type WorkspaceSubscriptionSummary,
} from "@/features/billing/billing-plan-data";
import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";
import { loadWorkspaceQuotaSnapshot } from "@/features/billing/workspace-quota-client";
import { fetchFreeChatTurnsUsage } from "@/features/chat/persistence/client";
import {
  type AppSidebarAccountBadge,
  type AppSidebarAccountHint,
  deriveAppSidebarAccountPresentation,
} from "@/features/shell/app-sidebar-account-presentation";
import {
  AI_CREDITS_ROW_LABEL,
  aiUsageRowFromCredits,
  aiUsageRowFromFreeTurns,
  FREE_TRIAL_MESSAGES_ROW_LABEL,
} from "@/features/shell/app-sidebar-ai-usage";
import {
  type AppSidebarQuotaRow,
  formatWorkspaceQuotaRows,
  quotaUsageTone,
} from "@/features/shell/app-sidebar-quota";
import { useCloseOnSidebarToggle } from "@/features/shell/use-close-on-sidebar-toggle";
import {
  appTokenAtom,
  desktopUserAvatarAtom,
  desktopUserIdAtom,
  desktopUserNameAtom,
  kubeconfigAtom,
  namespaceAtom,
} from "@/lib/auth-store";
import { useSealosDesktopUrl } from "@/lib/sealos-desktop-url";

const HINT_TEXT_CLASS: Record<AppSidebarAccountHint["tone"], string> = {
  danger: "text-red-400",
  warn: "text-amber-400",
};

const COPY_FEEDBACK_MS = 1500;

function AppSidebarAccountAvatar({
  avatarUrl,
  className,
  name,
}: {
  avatarUrl: string;
  className?: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  if (avatarUrl !== "" && !failed) {
    return (
      // biome-ignore lint/performance/noImgElement: the Desktop-hosted avatar is a runtime cross-origin URL; next/image optimization gains nothing for a 24px disc.
      <img
        alt=""
        aria-hidden
        className={cn("shrink-0 rounded-full object-cover", className)}
        height={24}
        onError={() => setFailed(true)}
        src={avatarUrl}
        width={24}
      />
    );
  }
  const initial = name.slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-400 to-blue-600 font-medium text-white",
        className
      )}
    >
      {initial === "" ? (
        <User aria-hidden className="size-3.5" strokeWidth={1.8} />
      ) : (
        initial
      )}
    </span>
  );
}

function AppSidebarAccountBadgeSlot({
  badge,
}: {
  badge: AppSidebarAccountBadge | null;
}) {
  if (badge == null) {
    return null;
  }
  if (badge.kind === "payg") {
    return <span className="text-muted-foreground text-xs">PAYG</span>;
  }
  return <PlanBadge className="h-4 text-xs" planName={badge.planName} />;
}

const USAGE_BAR_CLASS: Record<"danger" | "warn", string> = {
  danger: "bg-red-400",
  warn: "bg-amber-400",
};

function AppSidebarQuotaBar({ percent }: { percent: number | null }) {
  const tone = quotaUsageTone(percent);
  return (
    <span
      aria-hidden
      className="block h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-input/50"
    >
      <span
        className={cn(
          "block h-full rounded-full",
          tone == null ? "bg-blue-400" : USAGE_BAR_CLASS[tone]
        )}
        style={{ width: `${percent ?? 0}%` }}
      />
    </span>
  );
}

function AppSidebarUsageRow({
  className,
  label,
  labelClassName,
  row,
  slot,
}: {
  className?: string;
  label: string;
  labelClassName: string;
  row: AppSidebarQuotaRow;
  slot: string;
}) {
  const tone = quotaUsageTone(row.percent);
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      data-danger={tone === "danger" ? "true" : undefined}
      data-slot={slot}
      data-warning={tone === "warn" ? "true" : undefined}
    >
      <span
        className={cn("shrink-0 text-muted-foreground text-xs", labelClassName)}
      >
        {label}
      </span>
      <AppSidebarQuotaBar percent={row.percent} />
      <span
        className={cn(
          "shrink-0 text-right text-xs tabular-nums",
          tone == null ? undefined : HINT_TEXT_CLASS[tone]
        )}
      >
        {row.value}
      </span>
    </div>
  );
}

// The workspace quota rows as displayed, in their fixed order — the first-open
// skeleton writes the real labels because only the values are unknown.
const QUOTA_SKELETON_LABELS = [
  "CPU",
  "Mem",
  "Storage",
  "Pods",
  "Ports",
] as const;

// Data replacing its skeleton fades in briefly; the geometry never moves.
const USAGE_FILL_CLASS =
  "animate-in fade-in duration-150 motion-reduce:animate-none";

/**
 * A usage row's first-open placeholder: the real label (or a shimmer block
 * while the subscription is still unknown), the empty bar track, and a
 * shimmer where the value lands. Same geometry as the filled row, so data
 * arriving never moves the popover.
 */
function AppSidebarUsageRowSkeleton({
  label,
  labelClassName,
  slot,
}: {
  label: string | null;
  labelClassName?: string;
  slot: string;
}) {
  return (
    <div aria-hidden className="flex h-4 items-center gap-2" data-slot={slot}>
      {label == null ? (
        <Skeleton className="h-3 w-16 shrink-0 rounded-sm" />
      ) : (
        <span
          className={cn(
            "shrink-0 text-muted-foreground text-xs",
            labelClassName
          )}
        >
          {label}
        </span>
      )}
      <span className="block h-1 min-w-0 flex-1 rounded-full bg-input/50" />
      <Skeleton className="h-3 w-10 shrink-0 rounded-sm" />
    </div>
  );
}

function useCopyFeedback(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const copy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => setCopied(false),
      COPY_FEEDBACK_MS
    );
  }, []);
  return [copied, copy];
}

async function loadQuotaRows(namespace: string): Promise<AppSidebarQuotaRow[]> {
  // The quota client fails open (undefined instead of rejecting); surface
  // that as a failure so the slot keeps its snapshot-or-collapse contract
  // instead of rendering a list of "--/--" placeholders.
  const snapshot = await loadWorkspaceQuotaSnapshot(namespace);
  if (snapshot == null) {
    throw new Error("workspace quota unavailable");
  }
  return formatWorkspaceQuotaRows(snapshot.items);
}

interface UsageSlotState<T> {
  /** Latest fulfilled value; null = no snapshot yet, or "not applicable". */
  data: T | null;
  /** The commit replaced a visible skeleton this open — drives the fade. */
  justFilled: boolean;
  pending: boolean;
  resetFade: () => void;
  /** Some load fulfilled at least once — a fulfilled null is a snapshot too. */
  settled: boolean;
}

/**
 * One usage slot's load lifecycle: refresh while `active`, commit alone —
 * the AI and quota slots ride different transports, so a slow or failed side
 * never holds the other back. The sequence counter drops a settling load
 * once a newer refresh superseded it; a rejection keeps the previous
 * snapshot (on a first open the skeleton collapses instead of pinning).
 */
function useUsageSlot<T>(
  active: boolean,
  load: () => Promise<T | null>,
  warnLabel: string
): UsageSlotState<T> {
  const [data, setData] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const [settled, setSettled] = useState(false);
  const [justFilled, setJustFilled] = useState(false);
  const dataRef = useRef<T | null>(null);
  const seqRef = useRef(0);
  // Pending flips during render (compare-and-set) the moment a refresh is
  // (re)triggered — the skeleton's first frame, without an effect-time
  // setState cascading a second render.
  const [lastTrigger, setLastTrigger] = useState<{
    active: boolean;
    load: () => Promise<T | null>;
  } | null>(null);
  if (
    lastTrigger == null ||
    lastTrigger.active !== active ||
    lastTrigger.load !== load
  ) {
    setLastTrigger({ active, load });
    if (active) {
      setPending(true);
    }
  }
  useEffect(() => {
    if (!active) {
      return;
    }
    const seq = ++seqRef.current;
    load().then(
      (next) => {
        if (seqRef.current !== seq) {
          return;
        }
        setJustFilled(dataRef.current == null && next != null);
        dataRef.current = next;
        setData(next);
        setSettled(true);
        setPending(false);
      },
      (reason: unknown) => {
        if (seqRef.current !== seq) {
          return;
        }
        setPending(false);
        console.warn(`[AppSidebarAccount] ${warnLabel} failed:`, reason);
      }
    );
  }, [active, load, warnLabel]);
  const resetFade = useCallback(() => setJustFilled(false), []);
  return { data, justFilled, pending, resetFade, settled };
}

// While the subscription is unknown the AI slot is optimistically expected
// (ADR-0065 decides its existence): collapsing a placeholder later beats
// inserting a row that shoves the list down. A known PAYG never shows one.
function deriveAiSlotPresentation(
  credentialsReady: boolean,
  subscriptionPending: boolean,
  summary: WorkspaceSubscriptionSummary | undefined
): { expected: boolean; skeletonLabel: string | null } {
  const expected =
    credentialsReady &&
    (subscriptionPending || (summary != null && !summary.isPayg));
  let skeletonLabel: string | null = null;
  if (summary != null) {
    skeletonLabel = summary.isActiveFreeTrial
      ? FREE_TRIAL_MESSAGES_ROW_LABEL
      : AI_CREDITS_ROW_LABEL;
  }
  return { expected, skeletonLabel };
}

function AppSidebarUsageSection({
  aiJustFilled,
  aiRow,
  aiSkeletonLabel,
  quotaJustFilled,
  quotaRows,
  showAiSkeleton,
  showQuotaSkeleton,
}: {
  aiJustFilled: boolean;
  aiRow: AppSidebarQuotaRow | null;
  aiSkeletonLabel: string | null;
  quotaJustFilled: boolean;
  quotaRows: AppSidebarQuotaRow[] | null;
  showAiSkeleton: boolean;
  showQuotaSkeleton: boolean;
}) {
  let aiSlot: ReactNode = null;
  if (aiRow != null) {
    aiSlot = (
      <AppSidebarUsageRow
        className={aiJustFilled ? USAGE_FILL_CLASS : undefined}
        label={aiRow.label}
        labelClassName="whitespace-nowrap"
        row={aiRow}
        slot="app-sidebar-ai-usage-row"
      />
    );
  } else if (showAiSkeleton) {
    aiSlot = (
      <AppSidebarUsageRowSkeleton
        label={aiSkeletonLabel}
        labelClassName="whitespace-nowrap"
        slot="app-sidebar-ai-usage-skeleton"
      />
    );
  }
  let quotaSlot: ReactNode = null;
  if (quotaRows != null && quotaRows.length > 0) {
    quotaSlot = quotaRows.map((row) => (
      <AppSidebarUsageRow
        className={quotaJustFilled ? USAGE_FILL_CLASS : undefined}
        key={row.label}
        label={row.label === "Memory" ? "Mem" : row.label}
        labelClassName="w-10"
        row={row}
        slot="app-sidebar-quota-row"
      />
    ));
  } else if (showQuotaSkeleton) {
    quotaSlot = QUOTA_SKELETON_LABELS.map((label) => (
      <AppSidebarUsageRowSkeleton
        key={label}
        label={label}
        labelClassName="w-10"
        slot="app-sidebar-quota-skeleton"
      />
    ));
  }
  if (aiSlot == null && quotaSlot == null) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {aiSlot}
      {quotaSlot}
    </div>
  );
}

// The AI row shows a skeleton only while its answer is still possible and
// pending: the subscription decides whether the row exists at all.
function shouldShowAiSkeleton(
  aiSlot: { settled: boolean; pending: boolean },
  expected: boolean,
  subscriptionPending: boolean
): boolean {
  return !aiSlot.settled && expected && (subscriptionPending || aiSlot.pending);
}

const MENU_ROW_CLASS =
  "group/menurow flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-sm transition-colors hover:bg-input/30";

function AppSidebarAccountMenuRow({
  href,
  icon,
  label,
  onClick,
  rel,
  target,
  trailing,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  rel?: string;
  target?: string;
  trailing?: ReactNode;
}) {
  return (
    <Link
      className={MENU_ROW_CLASS}
      href={href}
      onClick={onClick}
      rel={rel}
      target={target}
    >
      <span className="flex w-5 shrink-0 items-center justify-center text-neutral-50 transition-colors group-hover/menurow:text-blue-400">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing == null ? null : (
        <span className="flex shrink-0 items-center text-muted-foreground">
          {trailing}
        </span>
      )}
    </Link>
  );
}

// The row closest to its limit — drives the collapsed Usage row's summary.
function worstUsageRow(
  aiRow: AppSidebarQuotaRow | null,
  quotaRows: AppSidebarQuotaRow[] | null
): AppSidebarQuotaRow | null {
  let worst: AppSidebarQuotaRow | null = null;
  for (const row of [aiRow, ...(quotaRows ?? [])]) {
    if (row?.percent == null) {
      continue;
    }
    if (worst?.percent == null || row.percent > worst.percent) {
      worst = row;
    }
  }
  return worst;
}

/**
 * The collapsed Usage row's trailing summary: the worst row's label and
 * percentage, toned like the row itself once it crosses warn/danger.
 */
function usageStatusSlot(worst: AppSidebarQuotaRow | null): ReactNode {
  if (worst?.percent == null) {
    return null;
  }
  const tone = quotaUsageTone(worst.percent);
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        tone == null ? undefined : HINT_TEXT_CLASS[tone]
      )}
    >
      {`${worst.label === "Memory" ? "Mem" : worst.label} ${Math.round(worst.percent)}%`}
    </span>
  );
}

/**
 * The Usage entry: a plain menu row that expands in place, morphing the whole
 * block (row + usage rows) into a card. The chrome sits exactly on the
 * block's own bounds — the row keeps its full plain-sibling width open or
 * closed, and opening only fades in the background and ring (drawn inside
 * the box, so nothing shifts).
 */
function AppSidebarUsageAccordion({
  onToggle,
  open,
  statusSlot,
  usageSection,
}: {
  onToggle: () => void;
  open: boolean;
  statusSlot: ReactNode;
  usageSection: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md ring-1 ring-inset transition-[margin,box-shadow,background-color] duration-200 ease-out motion-reduce:transition-none",
        open ? "mb-0.5 bg-input/30 ring-border/60" : "mb-0 ring-transparent"
      )}
    >
      <div className="flex flex-col">
        <button
          aria-expanded={open}
          className={MENU_ROW_CLASS}
          onClick={onToggle}
          type="button"
        >
          <span
            className={cn(
              "flex w-5 shrink-0 items-center justify-center transition-colors group-hover/menurow:text-blue-400",
              open ? "text-blue-400" : "text-neutral-50"
            )}
          >
            <Gauge aria-hidden className="size-4" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1 truncate">Usage</span>
          <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
            {statusSlot}
            <ChevronRight
              aria-hidden
              className={cn(
                "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                open && "rotate-90"
              )}
              strokeWidth={1.8}
            />
          </span>
        </button>
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="px-2.5 pt-1.5 pb-2.5 [&>div]:gap-2">
              {usageSection}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppSidebarDesktopMenuRow() {
  const desktopUrl = useSealosDesktopUrl();
  return (
    <AppSidebarAccountMenuRow
      href={desktopUrl ?? "#"}
      icon={<House aria-hidden className="size-4" strokeWidth={1.8} />}
      label="Sealos Desktop"
      rel={desktopUrl ? "noopener noreferrer" : undefined}
      target={desktopUrl ? "_blank" : undefined}
      trailing={
        <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={1.8} />
      }
    />
  );
}

/**
 * The popover's functional block: the Usage entry, Billing, and the Sealos
 * Desktop Entry as menu rows, closed by the divider that separates them from
 * the Upgrade entry.
 */
function AppSidebarAccountMenuRows({
  aiRow,
  onToggleUsage,
  quotaRows,
  usageOpen,
  usageSection,
}: {
  aiRow: AppSidebarQuotaRow | null;
  onToggleUsage: () => void;
  quotaRows: AppSidebarQuotaRow[] | null;
  usageOpen: boolean;
  usageSection: ReactNode;
}) {
  const statusSlot = usageStatusSlot(worstUsageRow(aiRow, quotaRows));
  return (
    <>
      <div className="-mx-1.5 flex flex-col">
        <AppSidebarUsageAccordion
          onToggle={onToggleUsage}
          open={usageOpen}
          statusSlot={statusSlot}
          usageSection={usageSection}
        />
        <AppSidebarAccountMenuRow
          href="/billing"
          icon={<CreditCard aria-hidden className="size-4" strokeWidth={1.8} />}
          label="Billing"
          onClick={recordBillingReturnRoute}
        />
        <AppSidebarDesktopMenuRow />
      </div>
      <div aria-hidden className="h-px w-full bg-border" />
    </>
  );
}

/**
 * The account popover's body: identity, copyable ID, status hint, the menu
 * rows (Usage, Billing, Sealos Desktop), and the Upgrade entry.
 */
function AppSidebarAccountMenuView({
  aiRow,
  badge,
  copied,
  displayName,
  hint,
  onCopyId,
  onToggleUsage,
  quotaRows,
  usageOpen,
  usageSection,
  userAvatar,
  userId,
  userName,
}: {
  aiRow: AppSidebarQuotaRow | null;
  badge: AppSidebarAccountBadge | null;
  copied: boolean;
  displayName: string;
  hint: AppSidebarAccountHint | null;
  onCopyId: () => void;
  onToggleUsage: () => void;
  quotaRows: AppSidebarQuotaRow[] | null;
  usageOpen: boolean;
  usageSection: ReactNode;
  userAvatar: string;
  userId: string;
  userName: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <AppSidebarAccountAvatar
          avatarUrl={userAvatar}
          className="size-6 text-[10px]"
          name={userName}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {displayName}
        </span>
        <AppSidebarAccountBadgeSlot badge={badge} />
      </div>
      {userId === "" ? null : (
        <button
          aria-label="Copy user ID"
          className="flex cursor-pointer items-center gap-1 text-muted-foreground text-xs tabular-nums transition-colors hover:text-neutral-50"
          onClick={onCopyId}
          type="button"
        >
          <span className="truncate">ID: {userId}</span>
          {copied ? (
            <Check aria-hidden className="size-3" strokeWidth={1.8} />
          ) : (
            <Copy aria-hidden className="size-3" strokeWidth={1.8} />
          )}
        </button>
      )}
      {hint == null ? null : (
        <div className={cn("text-xs", HINT_TEXT_CLASS[hint.tone])}>
          {hint.text}
        </div>
      )}
      <div aria-hidden className="h-px w-full bg-border" />
      <AppSidebarAccountMenuRows
        aiRow={aiRow}
        onToggleUsage={onToggleUsage}
        quotaRows={quotaRows}
        usageOpen={usageOpen}
        usageSection={usageSection}
      />
      <Link
        className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-input/40 font-medium text-neutral-50 text-sm transition-colors hover:bg-input/60"
        href="/billing?mode=upgrade"
        onClick={recordBillingReturnRoute}
      >
        <Sparkles aria-hidden className="size-4" strokeWidth={1.75} />
        Upgrade
      </Link>
    </div>
  );
}

/**
 * The App Sidebar's account section (AIM-308): identity row with the plan
 * badge, opening the compact account popover — identity, copyable user ID,
 * status hint, the menu rows (Usage with the quota bars folded into its
 * expansion, Billing, the Sealos Desktop Entry), and the upgrade entry.
 * Replaces the old Upgrade button as the sidebar's single quota surface.
 *
 * The usage section's first open renders skeleton rows at the final
 * geometry; the AI and quota slots then fill independently. Reopens show the
 * previous snapshot while a silent refresh lands. A slot whose first load
 * fails collapses quietly instead of pinning its skeleton.
 */
export function AppSidebarAccount() {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const userId = useAtomValue(desktopUserIdAtom).trim();
  const userName = useAtomValue(desktopUserNameAtom).trim();
  const userAvatar = useAtomValue(desktopUserAvatarAtom).trim();
  const appToken = useAtomValue(appTokenAtom).trim();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const workspace = useAtomValue(namespaceAtom).trim();
  const credentialsReady =
    appToken !== "" && kubeconfig !== "" && workspace !== "";

  // Live billing data, not the login-time session snapshot: the badge and
  // hint follow the same subscription route as the Billing Area's hooks.
  const { data: subscriptionSummary, isLoading: subscriptionPending } = useSWR(
    credentialsReady
      ? (["app-sidebar-subscription", workspace, kubeconfig, appToken] as const)
      : null,
    () => loadWorkspaceSubscriptionSummary({ appToken, kubeconfig, workspace }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const { badge, hint } = useMemo(
    () =>
      deriveAppSidebarAccountPresentation(
        subscriptionSummary ?? null,
        new Date()
      ),
    [subscriptionSummary]
  );

  const [open, setOpen] = useState(false);
  // Collapsed anchor: the row keeps its full expanded width under the rail's
  // clipping (same trap as the nav-row tooltips), so the popover anchors the
  // w-9 icon slot instead of the trigger row.
  const iconSlotRef = useRef<HTMLSpanElement>(null);
  useCloseOnSidebarToggle(expanded, () => setOpen(false));
  // The Billing Plan view's credits-slot predicate (ADR-0065): Active Free
  // Trial → Free Chat Turns, other subscriptions → AI Credits, PAYG → none.
  const loadAiUsageRow = useCallback(async () => {
    if (
      !credentialsReady ||
      subscriptionSummary == null ||
      subscriptionSummary.isPayg
    ) {
      return null;
    }
    if (subscriptionSummary.isActiveFreeTrial) {
      const usage = await fetchFreeChatTurnsUsage({
        appToken,
        kubeconfig,
        namespace: workspace,
      });
      return usage == null ? null : aiUsageRowFromFreeTurns(usage);
    }
    return aiUsageRowFromCredits(
      await loadAiCredits({ appToken, kubeconfig, workspace })
    );
  }, [appToken, credentialsReady, kubeconfig, subscriptionSummary, workspace]);
  // Both slots refresh on every open. The AI slot additionally waits for the
  // subscription answer — it decides whether the row exists at all — so an
  // unknown subscription is pending, never "not applicable": opening before
  // it lands can no longer eat the row.
  const loadQuota = useCallback(() => loadQuotaRows(workspace), [workspace]);
  const quotaSlot = useUsageSlot(open, loadQuota, "load workspace quota");
  const aiSlot = useUsageSlot(
    open && !subscriptionPending,
    loadAiUsageRow,
    "load AI usage"
  );
  const resetQuotaFade = quotaSlot.resetFade;
  const resetAiFade = aiSlot.resetFade;
  // The Usage entry starts collapsed on every popover open instead of
  // remembering the last toggle.
  const [usageOpen, setUsageOpen] = useState(false);
  const toggleUsage = useCallback(() => setUsageOpen((value) => !value), []);
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        // Reopens mount straight from the snapshot — no replay of the fade.
        resetQuotaFade();
        resetAiFade();
        setUsageOpen(false);
      }
    },
    [resetAiFade, resetQuotaFade]
  );
  const [copied, copy] = useCopyFeedback();
  const copyUserId = useCallback(() => copy(userId), [copy, userId]);

  const displayName = userName === "" ? "Account" : userName;
  const secondLine = hint?.text ?? (userId === "" ? null : `ID: ${userId}`);
  const secondLineClass =
    hint == null ? "text-muted-foreground" : HINT_TEXT_CLASS[hint.tone];

  const aiPresentation = deriveAiSlotPresentation(
    credentialsReady,
    subscriptionPending,
    subscriptionSummary
  );
  const showAiSkeleton = shouldShowAiSkeleton(
    aiSlot,
    aiPresentation.expected,
    subscriptionPending
  );
  const showQuotaSkeleton = quotaSlot.data == null && quotaSlot.pending;

  const usageSection = (
    <AppSidebarUsageSection
      aiJustFilled={aiSlot.justFilled}
      aiRow={aiSlot.data}
      aiSkeletonLabel={aiPresentation.skeletonLabel}
      quotaJustFilled={quotaSlot.justFilled}
      quotaRows={quotaSlot.data}
      showAiSkeleton={showAiSkeleton}
      showQuotaSkeleton={showQuotaSkeleton}
    />
  );

  const trigger = (
    <button
      aria-label={`Account: ${displayName}`}
      className={cn(
        "group/account relative flex w-full shrink-0 cursor-pointer items-center overflow-hidden rounded-md text-left transition-[height,margin] motion-reduce:transition-none",
        expanded
          ? "h-12 duration-300 ease-sidebar"
          : "h-9 duration-200 ease-out"
      )}
      data-slot="app-sidebar-account"
      type="button"
    />
  );

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger render={trigger}>
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 rounded-md transition-[width,background-color] group-hover/account:bg-input/30 motion-reduce:transition-none",
            expanded
              ? "w-full duration-300 ease-sidebar"
              : "w-9 duration-200 ease-out"
          )}
        />
        <span
          className="relative flex w-9 shrink-0 items-center justify-center"
          ref={iconSlotRef}
        >
          <AppSidebarAccountAvatar
            avatarUrl={userAvatar}
            className="size-6 text-[10px]"
            name={userName}
          />
        </span>
        <span
          className={cn(
            "relative min-w-0 flex-1 transition-opacity motion-reduce:transition-none",
            expanded
              ? "opacity-100 duration-300 ease-sidebar"
              : "opacity-0 duration-200 ease-out"
          )}
        >
          <span className="block truncate font-medium text-neutral-50 text-sm/4">
            {displayName}
          </span>
          {secondLine == null ? null : (
            <span
              className={cn(
                "mt-0.5 block truncate text-xs tabular-nums",
                secondLineClass
              )}
              data-slot="app-sidebar-account-status"
            >
              {secondLine}
            </span>
          )}
        </span>
        <span
          className={cn(
            "relative flex shrink-0 items-center pr-2 transition-opacity motion-reduce:transition-none",
            expanded
              ? "opacity-100 duration-300 ease-sidebar"
              : "opacity-0 duration-200 ease-out"
          )}
        >
          <AppSidebarAccountBadgeSlot badge={badge} />
        </span>
      </PopoverTrigger>
      {/* Collapsed rail: anchor the icon slot, sideOffset 6 (the rail-wide
          convention for popovers) — the default trigger anchor sits at the
          clipped full-width row's edge, far past the visible rail. */}
      <PopoverContent
        align="start"
        anchor={expanded ? undefined : iconSlotRef}
        className="w-56 gap-0 rounded-lg border border-border bg-input/30 p-3 text-brand-primary-foreground shadow-none ring-0 backdrop-blur-xl"
        side={expanded ? "top" : "right"}
        sideOffset={6}
      >
        <AppSidebarAccountMenuView
          aiRow={aiSlot.data}
          badge={badge}
          copied={copied}
          displayName={displayName}
          hint={hint}
          onCopyId={copyUserId}
          onToggleUsage={toggleUsage}
          quotaRows={quotaSlot.data}
          usageOpen={usageOpen}
          usageSection={usageSection}
          userAvatar={userAvatar}
          userId={userId}
          userName={userName}
        />
      </PopoverContent>
    </Popover>
  );
}
