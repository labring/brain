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
      className="relative isolate flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row"
      data-slot="billing-tab-shell"
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(67%_75%_at_47%_44%,color-mix(in_oklab,var(--color-canvas-glow)_20%,transparent),transparent)]"
      />
      <aside className="shrink-0 border-border border-b bg-background lg:w-50 lg:overflow-y-auto lg:border-r lg:border-b-0">
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
  );
}

export default function BillingTabShell({ children }: { children: ReactNode }) {
  return (
    <BillingNavigationFrame activeTab={billingTabFromPathname(usePathname())}>
      {children}
    </BillingNavigationFrame>
  );
}
