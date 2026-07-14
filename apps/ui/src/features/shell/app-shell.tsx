"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import AppSidebar from "@/features/shell/app-sidebar";

/**
 * Composable app chrome. Use **named exports** from this file in Server Components
 * (e.g. `AppShellChrome`); object access like `AppShell.Chrome` can be undefined on
 * the RSC → client boundary — see `AppShell` namespace for client-only usage.
 */
export function AppShellChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-svh max-h-svh min-h-0 overflow-hidden overscroll-x-none">
      {children}
    </div>
  );
}

export const AppShellSidebar = AppSidebar;

export function AppShellView({
  children,
  className,
  ...rest
}: ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-x-none",
        className
      )}
      {...rest}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-x-none">
          {children}
        </div>
      </div>
    </main>
  );
}

/**
 * Main column without the sidebar: full viewport, scrolls like {@link AppShellView} but no inset / trigger.
 */
export function AppShellSolo({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-svh max-h-svh min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden overscroll-x-none",
        className
      )}
    >
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-auto overscroll-x-none">
        {children}
      </div>
    </div>
  );
}

/** Client-only convenience namespace; prefer named exports from server layouts. */
export const AppShell = {
  Chrome: AppShellChrome,
  Sidebar: AppShellSidebar,
  View: AppShellView,
  Solo: AppShellSolo,
} as const;
