"use client";

import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { scheduleChatDevboxWarmup } from "@/features/chat/devbox/devbox.actions";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

/**
 * Dispatches {@link scheduleChatDevboxWarmup} once the Brain Session has
 * landed its credentials. Devbox work runs on the server after the action
 * resolves (does not block the UI).
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
