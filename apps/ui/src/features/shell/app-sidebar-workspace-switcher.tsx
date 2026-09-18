"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { useSidebar } from "@workspace/ui/components/sidebar";
import { WorkspaceAvatar } from "@workspace/ui/components/workspace-avatar";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";
import type { SessionWorkspace } from "@/features/session/session-schema";
import {
  deriveWorkspaceSwitcherPresentation,
  type WorkspaceSwitcherBadge,
  type WorkspaceSwitcherHint,
} from "@/features/shell/app-sidebar-workspace-presentation";
import { useCloseOnSidebarToggle } from "@/features/shell/use-close-on-sidebar-toggle";
import { useWorkspaceSubscriptionSummary } from "@/features/shell/use-workspace-subscription-summary";
import { useWorkspaceList } from "@/features/workspace/use-workspace-list";
import { useWorkspacePlans } from "@/features/workspace/use-workspace-plans";
import {
  PlanSlot,
  planNameFor,
  workspaceRoleLabel,
} from "@/features/workspace/workspace-plan-slot";
import { recordWorkspaceReturnRoute } from "@/features/workspace/workspace-return-route";
import {
  workspaceSwitchLanding,
  workspaceSwitchUrl,
} from "@/features/workspace/workspace-switch-core";
import {
  isSwitchAvailable,
  navigateTopWindow,
} from "@/features/workspace/workspace-switch-environment";
import { currentWorkspaceAtom, desktopDomainAtom } from "@/lib/auth-store";

export const SWITCH_UNAVAILABLE_NOTICE =
  "Switching happens in Sealos Desktop. Open Brain from Desktop to switch.";
export const SWITCH_PENDING_NOTICE =
  "Waiting for Sealos Desktop to answer before switching.";

/** Why the "Switch to" rows are disabled, or null when they are live. */
type SwitchBlock = "outside-desktop" | "desktop-pending" | null;

const SWITCH_BLOCK_NOTICE: Record<NonNullable<SwitchBlock>, string> = {
  "desktop-pending": SWITCH_PENDING_NOTICE,
  "outside-desktop": SWITCH_UNAVAILABLE_NOTICE,
};

const HINT_TEXT_CLASS: Record<WorkspaceSwitcherHint["tone"], string> = {
  danger: "text-red-400",
  warn: "text-amber-400",
};

const MENU_ROW_CLASS =
  "group/wsrow flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-sm transition-colors hover:bg-input/30 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

function fadeClass(expanded: boolean): string {
  return expanded
    ? "opacity-100 duration-300 ease-sidebar"
    : "opacity-0 duration-200 ease-out";
}

/** The current Workspace's badge as the shared plan slot reads it. */
function planNameFromBadge(
  badge: WorkspaceSwitcherBadge | null
): string | null | undefined {
  if (badge == null) {
    return undefined;
  }
  return badge.kind === "payg" ? null : badge.planName;
}

const SWITCHER_BADGE_CLASS = "h-4 text-xs";

function WorkspaceSwitcherMenuRow({
  href,
  icon,
  label,
  onClick,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link className={MENU_ROW_CLASS} href={href} onClick={onClick}>
      <span className="flex w-6 shrink-0 items-center justify-center text-neutral-50 transition-colors group-hover/wsrow:text-blue-400">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
}

/**
 * The popover's body (spec §C.4): the current Workspace's card, the
 * "Switch to" list of the other Workspaces (Personal first, as Desktop
 * orders them), then New Workspace and Manage Workspaces. No pending
 * invitations (the platform has no such state), no Usage / Upgrade /
 * Billing — those stay in the account popover.
 */
function WorkspaceSwitcherMenu({
  current,
  currentBadge,
  onClose,
  onSwitch,
  others,
  plans,
  switchBlock,
}: {
  current: SessionWorkspace;
  currentBadge: WorkspaceSwitcherBadge | null;
  onClose: () => void;
  onSwitch: (workspace: SessionWorkspace) => void;
  others: SessionWorkspace[];
  plans: Record<string, string | null> | undefined;
  switchBlock: SwitchBlock;
}) {
  const canSwitch = switchBlock == null;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center gap-2"
        data-slot="app-sidebar-workspace-card"
      >
        <WorkspaceAvatar className="size-8" square workspaceId={current.id} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm/4">
            {current.name}
          </span>
          <span className="mt-0.5 block truncate text-muted-foreground text-xs">
            {workspaceRoleLabel(current)}
          </span>
        </span>
        <PlanSlot
          className={SWITCHER_BADGE_CLASS}
          planName={planNameFromBadge(currentBadge)}
        />
      </div>
      {others.length === 0 ? null : (
        <>
          <div aria-hidden className="h-px w-full bg-border" />
          <div className="-mx-1.5 flex flex-col">
            <div className="px-1.5 pb-1 font-medium text-muted-foreground text-xs">
              Switch to
            </div>
            {others.map((workspace) => (
              <button
                aria-label={`Switch to ${workspace.name}`}
                className={MENU_ROW_CLASS}
                data-slot="app-sidebar-workspace-switch"
                disabled={!canSwitch}
                key={workspace.uid}
                onClick={() => onSwitch(workspace)}
                type="button"
              >
                <span className="flex w-6 shrink-0 items-center justify-center">
                  <WorkspaceAvatar
                    className="size-5"
                    square
                    workspaceId={workspace.id}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-50">
                  {workspace.name}
                </span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {workspaceRoleLabel(workspace)}
                </span>
                <PlanSlot
                  className={SWITCHER_BADGE_CLASS}
                  planName={planNameFor(plans, workspace.id)}
                />
              </button>
            ))}
            {switchBlock == null ? null : (
              <p
                className="px-1.5 pt-1 text-muted-foreground text-xs"
                data-slot="app-sidebar-workspace-switch-notice"
              >
                {SWITCH_BLOCK_NOTICE[switchBlock]}
              </p>
            )}
          </div>
        </>
      )}
      <div aria-hidden className="h-px w-full bg-border" />
      <div className="-mx-1.5 flex flex-col">
        <WorkspaceSwitcherMenuRow
          href="/billing?mode=create"
          icon={<Plus aria-hidden className="size-4" strokeWidth={1.8} />}
          label="New Workspace"
          onClick={() => {
            recordBillingReturnRoute();
            onClose();
          }}
        />
        <WorkspaceSwitcherMenuRow
          href={`/workspace/${encodeURIComponent(current.uid)}`}
          icon={<Settings2 aria-hidden className="size-4" strokeWidth={1.8} />}
          label="Manage Workspaces"
          onClick={() => {
            recordWorkspaceReturnRoute();
            onClose();
          }}
        />
      </div>
    </div>
  );
}

/**
 * The Workspace Switcher (spec §C.2–C.6, CONTEXT.md): the row under the
 * brand slot naming the current Workspace — square avatar, name, the plan
 * of its Workspace Subscription (PAYG without one), ⇕ — and the popover it
 * opens. When the subscription needs attention the row grows a second line
 * with the hint (the account row carries none of this). In the Collapsed
 * rail only the avatar remains and still opens the popover, to the right.
 * Choosing another Workspace hands the top window to Desktop's deep link
 * built from the SDK host config's cloud domain; outside the Desktop
 * iframe (or before Desktop answered) those rows are disabled with a notice.
 */
export function AppSidebarWorkspaceSwitcher() {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const current = useAtomValue(currentWorkspaceAtom);
  const desktopDomain = useAtomValue(desktopDomainAtom);
  const workspaces = useWorkspaceList();
  const workspaceIds = useMemo(
    () => workspaces.map((workspace) => workspace.id),
    [workspaces]
  );
  const plans = useWorkspacePlans(workspaceIds);
  const { data: subscriptionSummary } = useWorkspaceSubscriptionSummary();
  const { badge, hint } = useMemo(
    () =>
      deriveWorkspaceSwitcherPresentation(
        subscriptionSummary ?? null,
        new Date()
      ),
    [subscriptionSummary]
  );

  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useCloseOnSidebarToggle(expanded, close);
  // Collapsed anchor: the row keeps its full expanded width under the
  // rail's clipping, so the popover anchors the w-9 icon slot.
  const iconSlotRef = useRef<HTMLSpanElement>(null);

  const cloudDomain = desktopDomain.trim();
  let switchBlock: SwitchBlock = null;
  if (!isSwitchAvailable()) {
    switchBlock = "outside-desktop";
  } else if (cloudDomain === "") {
    switchBlock = "desktop-pending";
  }
  const handleSwitch = useCallback(
    (workspace: SessionWorkspace) => {
      const url = workspaceSwitchUrl({
        cloudDomain,
        landing: workspaceSwitchLanding(window.location),
        workspaceUid: workspace.uid,
      });
      if (url == null) {
        return;
      }
      setOpen(false);
      navigateTopWindow(url);
    },
    [cloudDomain]
  );

  if (current == null) {
    return null;
  }
  const others = workspaces.filter(
    (workspace) => workspace.uid !== current.uid
  );
  const twoLines = hint != null;

  const trigger = (
    <button
      aria-label={`Workspace: ${current.name}. Switch workspace`}
      className={cn(
        "group/ws relative flex w-full shrink-0 cursor-pointer items-center overflow-hidden rounded-md text-left transition-[height] motion-reduce:transition-none",
        expanded && twoLines
          ? "h-12 duration-300 ease-sidebar"
          : "h-9 duration-200 ease-out"
      )}
      data-slot="app-sidebar-workspace"
      type="button"
    />
  );

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={trigger}>
        {/* No outline at rest: the fill appears on hover and while open. */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 rounded-md transition-[width,background-color] group-hover/ws:bg-input/30 group-data-popup-open/ws:bg-input/30 motion-reduce:transition-none",
            expanded
              ? "w-full duration-300 ease-sidebar"
              : "w-9 duration-200 ease-out"
          )}
        />
        <span
          className="relative flex w-9 shrink-0 items-center justify-center self-stretch"
          ref={iconSlotRef}
        >
          <WorkspaceAvatar className="size-6" square workspaceId={current.id} />
        </span>
        <span
          className={cn(
            "relative min-w-0 flex-1 transition-opacity motion-reduce:transition-none",
            fadeClass(expanded)
          )}
        >
          <span className="block truncate font-medium text-neutral-50 text-sm/4">
            {current.name}
          </span>
          {hint == null ? null : (
            <span
              className={cn(
                "mt-0.5 block truncate text-xs",
                HINT_TEXT_CLASS[hint.tone]
              )}
              data-slot="app-sidebar-workspace-status"
            >
              {hint.text}
            </span>
          )}
        </span>
        <span
          className={cn(
            "relative flex shrink-0 items-center gap-1.5 pr-2 text-muted-foreground transition-opacity motion-reduce:transition-none",
            fadeClass(expanded)
          )}
        >
          <PlanSlot
            className={SWITCHER_BADGE_CLASS}
            planName={planNameFromBadge(badge)}
          />
          <ChevronsUpDown aria-hidden className="size-3.5" strokeWidth={1.8} />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        anchor={expanded ? undefined : iconSlotRef}
        className="w-64 gap-0 rounded-lg border border-border bg-input/30 p-3 text-brand-primary-foreground shadow-none ring-0 backdrop-blur-xl"
        side={expanded ? "bottom" : "right"}
        sideOffset={6}
      >
        <WorkspaceSwitcherMenu
          current={current}
          currentBadge={badge}
          onClose={close}
          onSwitch={handleSwitch}
          others={others}
          plans={plans}
          switchBlock={switchBlock}
        />
      </PopoverContent>
    </Popover>
  );
}
