"use client";

import { EVENT_NAME } from "@labring/sealos-desktop-sdk";
import { createSealosApp, sealosApp } from "@labring/sealos-desktop-sdk/app";
import { useAtomValue, useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { useEffect } from "react";
import { scheduleChatDevboxWarmup } from "@/features/chat/devbox/devbox.actions";
import { applySealosSdkHydration } from "@/features/shell/auth-bootstrap-core";
import {
  desktopLanguageAtom,
  desktopUserIdAtom,
  kubeconfigAtom,
  namespaceAtom,
} from "@/lib/auth-store";
import { namespaceFromKubeconfigText } from "@/lib/kubeconfig-namespace-core";

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
  const setDesktopLanguage = useSetAtom(desktopLanguageAtom);
  const setDesktopUserId = useSetAtom(desktopUserIdAtom);
  const setKubeconfig = useSetAtom(kubeconfigAtom);
  const setNamespace = useSetAtom(namespaceAtom);

  useEffect(() => {
    let cancelled = false;
    const cleanup = createSealosApp();
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
          setDesktopLanguage,
          setDesktopUserId,
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
  }, [setDesktopLanguage, setDesktopUserId, setKubeconfig, setNamespace]);

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
        if (!result.ok) {
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
