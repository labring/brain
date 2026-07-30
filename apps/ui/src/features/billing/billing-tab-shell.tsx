"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Calculator, ChartPie, Dock, ReceiptText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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

export function BillingNavigationFrame({
  activeTab,
  children,
}: {
  activeTab: BillingTab | null;
  children: ReactNode;
}) {
  return (
    <div
      className="min-h-0 flex-1 overflow-auto bg-background"
      data-slot="billing-tab-shell"
    >
      <div className="mx-auto flex min-h-full w-full max-w-screen-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:px-10 lg:py-10">
        <aside className="shrink-0 lg:w-48">
          <div className="lg:sticky lg:top-10">
            <h1 className="mb-4 px-3 font-semibold text-foreground text-lg">
              Billing
            </h1>
            <nav
              aria-label="Billing sections"
              className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible"
              data-slot="billing-section-navigation"
            >
              {BILLING_TABS.map((tab) => {
                const active = tab.value === activeTab;
                const Icon = BILLING_TAB_ICONS[tab.value];
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 font-normal text-muted-foreground text-sm transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 lg:gap-2 lg:px-3",
                      active && "bg-muted font-medium text-foreground"
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
          </div>
        </aside>
        <div className="min-w-0 flex-1" data-slot="billing-section-content">
          {children}
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
