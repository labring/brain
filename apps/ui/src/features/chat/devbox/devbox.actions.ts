"use server";

import { after } from "next/server";
import { bootstrapChatDevboxIfNeeded } from "@/features/chat/devbox/chat-runtime";
import { isDevboxConfigured } from "@/lib/devbox/config";
import { decodeKubeconfig } from "@/lib/kubeconfig";

export type ChatDevboxWarmupResult =
  | { ok: true }
  | { ok: false; reason: "credentials" | "unconfigured" };

/**
 * Schedules Devbox create/reuse + kubectl permission bootstrap after the action
 * returns, so the client is not blocked on runtime startup.
 *
 * Fires on every project page load, so a deployment without Devbox env skips
 * silently rather than logging a failed bootstrap each time.
 */
export async function scheduleChatDevboxWarmup(
  encodedKubeconfig: string,
  namespace: string
): Promise<ChatDevboxWarmupResult> {
  if (!isDevboxConfigured()) {
    return { ok: false, reason: "unconfigured" };
  }

  const kubeconfig = decodeKubeconfig(encodedKubeconfig);
  const trimmedNamespace = namespace.trim();
  if (
    kubeconfig == null ||
    kubeconfig.trim() === "" ||
    trimmedNamespace === ""
  ) {
    return { ok: false, reason: "credentials" };
  }

  after(() => {
    bootstrapChatDevboxIfNeeded({
      kubeconfig,
      namespace: trimmedNamespace,
    }).catch((err: unknown) => {
      console.error("[scheduleChatDevboxWarmup] background:", err);
    });
  });

  await Promise.resolve();
  return { ok: true };
}
