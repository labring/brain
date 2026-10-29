"use client";

import { EVENT_NAME } from "@labring/sealos-desktop-sdk";
import { createSealosApp, sealosApp } from "@labring/sealos-desktop-sdk/app";
import { useAtomValue, useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { useEffect } from "react";
import { configureBrainAnalyticsTransport } from "@/features/analytics/brain-analytics-transport";
import { scheduleChatDevboxWarmup } from "@/features/chat/devbox/devbox.actions";
import { readMarketingAttribution } from "@/features/marketing/attribution-client";
import { applySealosSdkHydration } from "@/features/shell/auth-bootstrap-core";
import {
  appTokenAtom,
  desktopLanguageAtom,
  desktopUserAvatarAtom,
  desktopUserIdAtom,
  desktopUserNameAtom,
  kubeconfigAtom,
  namespaceAtom,
} from "@/lib/auth-store";
import { namespaceFromKubeconfigText } from "@/lib/kubeconfig-namespace-core";
import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

/** Hydrates kubeconfig / namespace into Jotai from server props or dev env overrides. */

interface AuthBootstrapProps {
  serverEncodedKubeconfig: string;
  serverNamespace: string;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function eventLanguage(event: unknown): string {
  if (typeof event === "string") {
    return event.trim();
  }
  if (
    typeof event === "object" &&
    event !== null &&
    "lng" in event &&
    typeof event.lng === "string"
  ) {
    return event.lng.trim();
  }
  return "";
}

export default function AuthBootstrap({
  serverEncodedKubeconfig,
  serverNamespace,
}: AuthBootstrapProps) {
  const devEncodedKubeconfig = safeDecode(
    process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG ?? ""
  ).trim();
  const fallbackKubeconfig = safeDecode(serverEncodedKubeconfig).trim();
  const fallbackNamespace = serverNamespace.trim();

  // Dev env is an all-or-nothing override vs server: when a dev kubeconfig is
  // set, derive its namespace from the same kubeconfig current context.
  const hasDevOverride = devEncodedKubeconfig !== "";
  const kubeconfig = hasDevOverride ? devEncodedKubeconfig : fallbackKubeconfig;
  const namespace = hasDevOverride
    ? (namespaceFromKubeconfigText(devEncodedKubeconfig) ?? "")
    : fallbackNamespace;

  useHydrateAtoms([
    [kubeconfigAtom, kubeconfig],
    [namespaceAtom, namespace],
  ]);

  return null;
}

/** Hydrates credentials from the Sealos Desktop iframe SDK when available. */
export function SealosSdkBootstrap() {
  const activeAppToken = useAtomValue(appTokenAtom);
  const activeKubeconfig = useAtomValue(kubeconfigAtom);
  const activeNamespace = useAtomValue(namespaceAtom);

  useEffect(() => {
    if (!(activeAppToken && activeKubeconfig && activeNamespace)) {
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ namespace: activeNamespace });
    // The server derives the UID from both credentials; no browser-provided
    // account or source is accepted by this bootstrap endpoint.
    fetch(`/api/marketing/acquisition?${query}`, {
      headers: personalResourceAuthHeaders({
        appToken: activeAppToken,
        kubeconfig: activeKubeconfig,
      }),
      method: "POST",
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [activeAppToken, activeKubeconfig, activeNamespace]);

  const setAppToken = useSetAtom(appTokenAtom);
  const setDesktopLanguage = useSetAtom(desktopLanguageAtom);
  const setDesktopUserAvatar = useSetAtom(desktopUserAvatarAtom);
  const setDesktopUserId = useSetAtom(desktopUserIdAtom);
  const setDesktopUserName = useSetAtom(desktopUserNameAtom);
  const setKubeconfig = useSetAtom(kubeconfigAtom);
  const setNamespace = useSetAtom(namespaceAtom);

  useEffect(() => {
    let cancelled = false;
    const cleanup = createSealosApp();
    readMarketingAttribution();
    if (window.parent !== window) {
      sealosApp
        .getHostConfig()
        .then((config) => {
          if (cancelled) {
            return;
          }
          const supported =
            "analytics" in config.features &&
            config.features.analytics === true;
          configureBrainAnalyticsTransport(
            supported
              ? (payload) => sealosApp.runEvents("trackAnalyticsEvent", payload)
              : null
          );
        })
        .catch(() => {
          if (!cancelled) {
            configureBrainAnalyticsTransport(null);
          }
        });
    }
    let unsubscribeLanguage: (() => void) | undefined;

    const hydrate = async () => {
      try {
        const [session, language] = await Promise.all([
          sealosApp.getSession().catch(() => null),
          sealosApp.getLanguage().catch(() => null),
        ]);
        if (cancelled) {
          return;
        }
        applySealosSdkHydration({
          language,
          session,
          setAppToken,
          setDesktopLanguage,
          setDesktopUserAvatar,
          setDesktopUserId,
          setDesktopUserName,
          setKubeconfig,
          setNamespace,
        });
      } catch (e: unknown) {
        if (!cancelled) {
          console.warn("[SealosSdkBootstrap] session hydrate failed:", e);
        }
      }
    };

    unsubscribeLanguage = sealosApp.addAppEventListen(
      EVENT_NAME.CHANGE_I18N,
      (event) => {
        const language = eventLanguage(event);
        if (language !== "") {
          setDesktopLanguage(language);
        }
      }
    );

    hydrate().catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribeLanguage?.();
      cleanup?.();
    };
  }, [
    setAppToken,
    setDesktopLanguage,
    setDesktopUserAvatar,
    setDesktopUserId,
    setDesktopUserName,
    setKubeconfig,
    setNamespace,
  ]);

  return null;
}

/**
 * Dispatches {@link scheduleChatDevboxWarmup} once credentials are hydrated.
 * Devbox work runs on the server after the action resolves (does not block the UI).
 */
export function DevboxBootstrap() {
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);

  useEffect(() => {
    const kubeconfigDecoded = kubeconfig.trim();
    const namespaceTrimmed = namespace.trim();
    if (kubeconfigDecoded === "" || namespaceTrimmed === "") {
      return;
    }

    const run = async () => {
      try {
        const result = await scheduleChatDevboxWarmup(
          encodeURIComponent(kubeconfigDecoded),
          namespaceTrimmed
        );
        if (!result.ok && result.reason === "credentials") {
          console.warn("[DevboxBootstrap] skipped: invalid credentials");
        }
      } catch (e: unknown) {
        console.warn("[DevboxBootstrap] schedule failed:", e);
      }
    };

    run().catch(() => undefined);
  }, [kubeconfig, namespace]);

  return null;
}
