"use client";

import { useSealosDesktopUrl } from "@/lib/sealos-desktop-url";

import type { BillingCta } from "./billing-cta";

export interface ResolvedBillingCta {
  external: boolean;
  href: string;
  label: string;
}

/** The CTA as this client can honor it right now. */
export function useResolvedBillingCta(cta: BillingCta): ResolvedBillingCta {
  const desktopUrl = useSealosDesktopUrl(cta.desktop?.app ?? "");
  if (cta.desktop != null && desktopUrl != null) {
    return { external: true, href: desktopUrl, label: cta.desktop.label };
  }
  return { external: false, href: cta.href, label: cta.label };
}
