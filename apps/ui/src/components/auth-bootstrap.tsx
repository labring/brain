"use client";

import { createSealosApp, sealosApp } from "@labring/sealos-desktop-sdk/app";
import { useAtomValue, useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { useCallback, useEffect } from "react";
import { namespaceFromKubeconfigText } from "@/lib/chat-runtime/kubeconfig-namespace-core";
import { scheduleChatDevboxWarmup } from "@/lib/devbox.actions";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

/**
 * Hydrates kubeconfig / namespace into Jotai from dev env or an optional
 * server fallback. Desktop iframe auth is resolved by {@link SealosSdkBootstrap}
 * because the desktop cookie can point at the wrong workspace.
 */

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

export function SealosSdkBootstrap() {
  const setKubeconfig = useSetAtom(kubeconfigAtom);
  const setNamespace = useSetAtom(namespaceAtom);

  const loadSession = useCallback(async () => {
    try {
      const session = await sealosApp.getSession();
      const kubeconfig = session.kubeconfig.trim();
      if (kubeconfig === "") {
        return;
      }
      setKubeconfig(kubeconfig);
      setNamespace(namespaceFromKubeconfigText(kubeconfig) ?? "");
    } catch (error) {
      if (!process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG) {
        console.warn("[SealosSdkBootstrap] desktop session unavailable", error);
      }
    }
  }, [setKubeconfig, setNamespace]);

  useEffect(() => {
    const cleanup = createSealosApp();
    loadSession().catch(() => undefined);
    const removeUserUpdateListener = sealosApp?.addAppEventListen(
      "user-update",
      () => {
        loadSession().catch(() => undefined);
      }
    );

    return () => {
      removeUserUpdateListener?.();
      cleanup?.();
    };
  }, [loadSession]);

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
