"use server";

import { after } from "next/server";
import { bootstrapChatDevboxIfNeeded } from "@/features/chat/devbox/chat-runtime";
import { decodeKubeconfig } from "@/lib/kubeconfig";

/**
 * Schedules Devbox create/reuse + kubectl permission bootstrap after the action
 * returns, so the client is not blocked on runtime startup.
 */
export async function scheduleChatDevboxWarmup(
  encodedKubeconfig: string,
  namespace: string
): Promise<{ ok: true } | { ok: false }> {
  const kubeconfig = decodeKubeconfig(encodedKubeconfig);
  const trimmedNamespace = namespace.trim();
  if (
    kubeconfig == null ||
    kubeconfig.trim() === "" ||
    trimmedNamespace === ""
  ) {
    return { ok: false };
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
