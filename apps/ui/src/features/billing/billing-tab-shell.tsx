"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Calculator, ChartPie, Dock, ReceiptText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AreaShell } from "@/features/shell/area-shell";

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

export function BillingNavigationFrame({
  activeTab,
  children,
}: {
  activeTab: BillingTab | null;
  children: ReactNode;
}) {
  return (
    <AreaShell
      aside={
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
                  "flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md p-2 font-medium text-primary text-sm leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
                  active
                    ? "bg-input text-foreground [&_svg]:text-blue-400"
                    : "hover:bg-input/30 hover:text-foreground"
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
      }
      asideClassName="lg:w-50"
      closeLabel="Close billing"
      icon={
        <ReceiptText
          aria-hidden
          className="size-4 shrink-0 text-blue-400"
          strokeWidth={2}
        />
      }
      readReturnRoute={readBillingReturnRoute}
      slot="billing-tab-shell"
      title="Billing"
    >
      <div
        className="min-w-0 flex-1 overflow-y-auto"
        data-slot="billing-section-content"
      >
        <div className="mx-auto w-full max-w-screen-2xl p-4">{children}</div>
      </div>
    </AreaShell>
  );
}

export default function BillingTabShell({ children }: { children: ReactNode }) {
  return (
    <BillingNavigationFrame activeTab={billingTabFromPathname(usePathname())}>
      {children}
    </BillingNavigationFrame>
  );
}
