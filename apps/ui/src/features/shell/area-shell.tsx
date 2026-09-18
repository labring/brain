"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import { X } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useSyncExternalStore } from "react";

/**
 * The chrome every product area shares (the Billing Area, the Workspace
 * Area; spec §D.2): a title bar with the area's icon and name, a close
 * button that returns to the area's recorded return address, and a
 * two-column body — an aside the area fills (section navigation, the
 * Workspace list) beside the area's content. The area supplies what
 * differs: the icon, the title, the close label, the return-route reader,
 * the aside and its width, and the content column.
 */

// The entry point is recorded once per navigation into an area and never
// changes while the area is mounted, so the store has nothing to publish
// after the initial read.
const subscribeToNothing = () => () => {
  // no-op unsubscribe
};

/**
 * Close returns to the in-app route the user entered the area from. The
 * server snapshot is the home fallback so server and client render the
 * same href; the recorded entry point only exists in the browser and lands
 * on the first client render after hydration.
 */
export function AreaCloseButton({
  label,
  readReturnRoute,
}: {
  label: string;
  readReturnRoute: () => string;
}) {
  const returnHref = useSyncExternalStore(
    subscribeToNothing,
    readReturnRoute,
    () => "/"
  );
  return (
    <AppIconButton
      aria-label={label}
      nativeButton={false}
      render={<Link href={returnHref} />}
      size="lg"
      variant="quiet"
    >
      <X aria-hidden className="size-4" />
    </AppIconButton>
  );
}

export function AreaShell({
  aside,
  asideClassName,
  children,
  closeLabel,
  icon,
  readReturnRoute,
  slot,
  title,
}: {
  /** The aside column's content: section navigation, a list. */
  aside: ReactNode;
  /** The aside's desktop width and anything else the area adds to it. */
  asideClassName?: string;
  /** The content column; the area owns its scrolling and padding. */
  children: ReactNode;
  closeLabel: string;
  icon: ReactNode;
  readReturnRoute: () => string;
  /** The `data-slot` naming the area's shell, e.g. `billing-tab-shell`. */
  slot: string;
  title: string;
}) {
  return (
    <div
      className="canvas-glow-overlay relative flex h-full min-h-0 flex-1 flex-col"
      data-slot={slot}
    >
      <header className="relative z-10 flex h-13 shrink-0 items-center justify-between gap-2 border-border border-b pr-2.5 pl-4">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h1 className="truncate font-semibold text-foreground text-lg leading-none">
            {title}
          </h1>
        </div>
        <AreaCloseButton label={closeLabel} readReturnRoute={readReturnRoute} />
      </header>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside
          className={cn(
            "shrink-0 border-border border-b lg:overflow-y-auto lg:border-r lg:border-b-0",
            asideClassName
          )}
        >
          {aside}
        </aside>
        {children}
      </div>
    </div>
  );
}
