"use client";

import { sealosApp } from "@labring/sealos-desktop-sdk/app";
import { useEffect, useState } from "react";

const DESKTOP_DOMAIN_TRAILING_SLASHES_RE = /\/+$/;
const DESKTOP_DOMAIN_SCHEME_RE = /^https?:\/\//i;

/**
 * Desktop deep link for the `?openapp=` launcher: an empty appKey lands on
 * the desktop itself, a key like "system-costcenter" opens that app.
 */
export function desktopOpenAppUrl(domain: string, appKey = ""): string | null {
  const trimmed = domain.trim().replace(DESKTOP_DOMAIN_TRAILING_SLASHES_RE, "");
  if (trimmed === "") {
    return null;
  }
  const origin = DESKTOP_DOMAIN_SCHEME_RE.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return `${origin}/?openapp=${appKey}`;
}

/**
 * The desktop deep link for this deployment, or null while loading and
 * outside the desktop iframe (previews, tests), where no host config exists.
 */
export function useSealosDesktopUrl(appKey = ""): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadDesktopUrl = async () => {
      if (!sealosApp) {
        return;
      }
      const hostConfig = await sealosApp.getHostConfig();
      const next = desktopOpenAppUrl(hostConfig.cloud.domain, appKey);
      if (!cancelled && next != null) {
        setUrl(next);
      }
    };

    loadDesktopUrl().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [appKey]);

  return url;
}
