"use client";

import { sealosApp } from "@labring/sealos-desktop-sdk/app";
import { PlanBadge } from "@workspace/ui/components/plan-badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { useSidebar } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { Check, Copy, Sparkles, User } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { loadAiCredits } from "@/features/billing/billing-ai-credits";
import { loadWorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";
import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";
import { fetchFreeChatTurnsUsage } from "@/features/chat/persistence/client";
import {
  type AppSidebarAccountBadge,
  type AppSidebarAccountHint,
  deriveAppSidebarAccountPresentation,
} from "@/features/shell/app-sidebar-account-presentation";
import {
  aiUsageRowFromCredits,
  aiUsageRowFromFreeTurns,
} from "@/features/shell/app-sidebar-ai-usage";
import {
  type AppSidebarQuotaRow,
  formatWorkspaceQuotaRows,
  isWorkspaceQuotaItem,
  quotaUsageTone,
} from "@/features/shell/app-sidebar-quota";
import {
  appTokenAtom,
  desktopUserAvatarAtom,
  desktopUserIdAtom,
  desktopUserNameAtom,
  kubeconfigAtom,
  namespaceAtom,
} from "@/lib/auth-store";

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
  label,
  labelClassName,
  row,
  slot,
}: {
  label: string;
  labelClassName: string;
  row: AppSidebarQuotaRow;
  slot: string;
}) {
  const tone = quotaUsageTone(row.percent);
  return (
    <div
      className="flex items-center gap-2"
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

async function loadQuotaRows(): Promise<AppSidebarQuotaRow[]> {
  const snapshot = await sealosApp.getWorkspaceQuota();
  const rawQuota: readonly unknown[] = Array.isArray(snapshot.quota)
    ? snapshot.quota
    : [];
  return formatWorkspaceQuotaRows(rawQuota.filter(isWorkspaceQuotaItem));
}

/**
 * The App Sidebar's account section (AIM-308): identity row with the plan
 * badge, opening the compact account popover — identity, copyable user ID,
 * status hint, workspace quota bars, and the upgrade entry. Replaces the old
 * Upgrade button as the sidebar's single quota surface.
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
  const { data: subscriptionSummary } = useSWR(
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
  // null = not loaded (or failed): the popover omits the quota section.
  const [quotaRows, setQuotaRows] = useState<AppSidebarQuotaRow[] | null>(null);
  // null = not loaded, failed, or not applicable: the row is omitted alone —
  // it rides a different data source than the workspace quota bars.
  const [aiUsageRow, setAiUsageRow] = useState<AppSidebarQuotaRow | null>(null);
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
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        return;
      }
      loadQuotaRows()
        .then(setQuotaRows)
        .catch((error: unknown) => {
          console.warn(
            "[AppSidebarAccount] load workspace quota failed:",
            error
          );
          setQuotaRows(null);
        });
      loadAiUsageRow()
        .then(setAiUsageRow)
        .catch((error: unknown) => {
          console.warn("[AppSidebarAccount] load AI usage failed:", error);
          setAiUsageRow(null);
        });
    },
    [loadAiUsageRow]
  );
  const [copied, copy] = useCopyFeedback();

  const displayName = userName === "" ? "Account" : userName;
  const secondLine = hint?.text ?? (userId === "" ? null : `ID: ${userId}`);
  const secondLineClass =
    hint == null ? "text-muted-foreground" : HINT_TEXT_CLASS[hint.tone];

  const trigger = (
    <button
      aria-label={`Account: ${displayName}`}
      className={cn(
        // PROTOTYPE(sidebar-density): var(--sbp-*, …) fallbacks are the shipped
        // values; see app-sidebar-density-prototype.tsx.
        "group/account relative flex w-full shrink-0 cursor-pointer items-center overflow-hidden rounded-[var(--sbp-radius,0.375rem)] text-left transition-[height] motion-reduce:transition-none",
        expanded
          ? "h-[var(--sbp-account,2.75rem)] duration-300 ease-sidebar"
          : "h-[var(--sbp-row,2rem)] duration-200 ease-out"
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
            "absolute inset-y-0 left-0 rounded-[var(--sbp-radius,0.375rem)] transition-[width,background-color] group-hover/account:bg-input/30 motion-reduce:transition-none",
            expanded
              ? "w-full duration-300 ease-sidebar"
              : "w-[var(--sbp-slot,2.25rem)] duration-200 ease-out"
          )}
        />
        <span className="relative flex w-[var(--sbp-slot,2.25rem)] shrink-0 items-center justify-center">
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
          <span className="block truncate font-medium text-[length:var(--sbp-font,0.875rem)] text-neutral-50 leading-4">
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
      <PopoverContent
        align="start"
        className="w-56 gap-0 rounded-lg border border-border bg-input/30 p-3 text-brand-primary-foreground shadow-none ring-0 backdrop-blur-xl"
        side={expanded ? "top" : "right"}
        sideOffset={6}
      >
        <div className="flex flex-col gap-2.5">
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
              onClick={() => copy(userId)}
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
          {aiUsageRow == null && quotaRows == null ? null : (
            <div className="flex flex-col gap-1.5">
              {aiUsageRow == null ? null : (
                <AppSidebarUsageRow
                  label={aiUsageRow.label}
                  labelClassName="whitespace-nowrap"
                  row={aiUsageRow}
                  slot="app-sidebar-ai-usage-row"
                />
              )}
              {quotaRows?.map((row) => (
                <AppSidebarUsageRow
                  key={row.label}
                  label={row.label === "Memory" ? "Mem" : row.label}
                  labelClassName="w-10"
                  row={row}
                  slot="app-sidebar-quota-row"
                />
              ))}
            </div>
          )}
          <Link
            className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-input/40 font-medium text-neutral-50 text-sm transition-colors hover:bg-input/60"
            href="/billing?mode=upgrade"
            onClick={recordBillingReturnRoute}
          >
            <Sparkles aria-hidden className="size-4" strokeWidth={1.75} />
            Upgrade
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
