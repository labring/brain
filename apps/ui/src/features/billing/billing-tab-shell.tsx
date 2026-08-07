"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import { Calculator, ChartPie, Dock, ReceiptText, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { readBillingReturnRoute } from "./billing-return-route";

export const BILLING_TABS = [
  { href: "/billing", label: "Plan", value: "plan" },
  { href: "/billing/costs", label: "Costs", value: "costs" },
  { href: "/billing/usage", label: "Usage", value: "usage" },
  { href: "/billing/pricing", label: "Pricing", value: "pricing" },
] as const;

export type BillingTab = (typeof BILLING_TABS)[number]["value"];

const BILLING_TAB_ICONS = {
  costs: ReceiptText,
  plan: Dock,
  pricing: Calculator,
  usage: ChartPie,
} as const;

export function billingTabFromPathname(pathname: string): BillingTab | null {
  if (pathname === "/billing" || pathname === "/billing/") {
    return "plan";
  }
  const tab = BILLING_TABS.slice(1).find(
    ({ href }) => pathname === href || pathname.startsWith(`${href}/`)
  );
  return tab?.value ?? null;
}

/**
 * Close returns to the in-app route the user entered the Billing Area from.
 * The stored route is read after hydration so server and client render the
 * same href; the recorded entry point only exists in the browser.
 */
function BillingCloseButton() {
  const [returnHref, setReturnHref] = useState("/");
  useEffect(() => {
    setReturnHref(readBillingReturnRoute());
  }, []);
  return (
    <AppIconButton
      aria-label="Close billing"
      nativeButton={false}
      render={<Link href={returnHref} />}
      size="lg"
      variant="quiet"
    >
      <X aria-hidden className="size-4" />
    </AppIconButton>
  );
}

export function BillingNavigationFrame({
  activeTab,
  children,
}: {
  activeTab: BillingTab | null;
  children: ReactNode;
}) {
  return (
    <div
      className="main-action-surface-background relative flex h-full min-h-0 flex-1 flex-col"
      data-slot="billing-tab-shell"
    >
      <header className="relative z-10 flex h-13 shrink-0 items-center justify-between gap-2 border-border border-b pr-2.5 pl-4">
        <div className="flex min-w-0 items-center gap-2">
          <ReceiptText
            aria-hidden
            className="size-4 shrink-0 text-blue-400"
            strokeWidth={2}
          />
          <h1 className="truncate font-semibold text-foreground text-lg leading-none">
            Billing
          </h1>
        </div>
        <BillingCloseButton />
      </header>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="shrink-0 border-border border-b lg:w-50 lg:overflow-y-auto lg:border-r lg:border-b-0">
          <nav
            aria-label="Billing sections"
            className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible"
            data-slot="billing-section-navigation"
          >
            {BILLING_TABS.map((tab) => {
              const active = tab.value === activeTab;
              const Icon = BILLING_TAB_ICONS[tab.value];
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md p-2 font-normal text-primary text-sm leading-none transition-colors hover:bg-input/30 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
                    active && "bg-input font-medium text-foreground"
                  )}
                  href={tab.href}
                  key={tab.value}
                >
                  <Icon aria-hidden className="size-4" strokeWidth={1.75} />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div
          className="min-w-0 flex-1 overflow-y-auto"
          data-slot="billing-section-content"
        >
          <div className="mx-auto w-full max-w-screen-2xl p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function BillingTabShell({ children }: { children: ReactNode }) {
  return (
    <BillingNavigationFrame activeTab={billingTabFromPathname(usePathname())}>
      {children}
    </BillingNavigationFrame>
  );
}
