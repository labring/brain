"use client";

import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";

import {
  DEPLOY_INTENT_CONTEXT_PART_TYPE,
  type DeployIntentContext,
  deployIntentPromptText,
} from "@/features/chat/persistence/deploy-intent-context";
import {
  clearDeployIntentParam,
  decodeDeployIntentQuery,
  readDeployIntentParam,
} from "@/features/deploy/deploy-intent-link";

/**
 * One-time consumption of the entry-URL deployment intent.
 *
 * The launcher (or a direct link) lands the user in Brain with
 * `?side=...&intent=<encoded-json>`; the intent must reach the Assistant
 * exactly once as a `data-deployIntent` part on the first synthetic user
 * message, then disappear from the URL so a refresh never re-sends it.
 *
 * Guards against duplicate sends:
 * - `history.replaceState` drops the `intent` param right before the send, so
 *   a refresh has nothing left to read;
 * - a module-level session set keyed by `chatId + raw value` survives React
 *   Strict Mode double-effects and remounts within the same page load.
 *
 * The value is decoded and structurally validated on the client purely so we
 * never send garbage; the server re-validates it fail-closed before the model
 * sees it (see `deploy-intent-validation` and ADR-0072).
 */

const consumedDeployIntentKeys = new Set<string>();

export interface DeployIntentConsumptionResult {
  /** Decoded + structurally valid intent to attach to the synthetic message. */
  intent: DeployIntentContext | null;
  /**
   * True when an `intent` param was present on this load (whether or not it
   * validated). The caller must clear the param in this case so the intent is
   * consumed exactly once.
   */
  present: boolean;
}

/** Pure consumption decision; call from an effect exactly once per mount. */
export function consumeDeployIntentFromUrl(options: {
  chatId: string;
  search: string;
}): DeployIntentConsumptionResult {
  const raw = readDeployIntentParam(options.search);
  if (raw == null) {
    return { intent: null, present: false };
  }
  const key = `${options.chatId}\u0000${raw}`;
  if (consumedDeployIntentKeys.has(key)) {
    return { intent: null, present: true };
  }
  consumedDeployIntentKeys.add(key);
  return { intent: decodeDeployIntentQuery(raw), present: true };
}

/** Test seam: reset the session-level consumption marker. */
export function resetConsumedDeployIntentKeys(): void {
  consumedDeployIntentKeys.clear();
}

export function useDeployIntentConsumer(options: {
  chatId: string;
  sendMessage: (message: {
    parts: UIMessage["parts"];
    role: "user";
  }) => Promise<unknown>;
}) {
  const { chatId, sendMessage } = options;
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) {
      return;
    }
    const result = consumeDeployIntentFromUrl({
      chatId,
      search: window.location.search,
    });
    if (!result.present) {
      return;
    }
    // Clear before sending: a refresh between now and the send completing must
    // not re-read the intent.
    clearDeployIntentParam();
    if (result.intent == null) {
      return;
    }
    sentRef.current = true;
    const intent = result.intent;
    sendMessage({
      role: "user",
      parts: [
        { type: DEPLOY_INTENT_CONTEXT_PART_TYPE, data: intent },
        { type: "text", text: deployIntentPromptText(intent) },
      ],
    }).catch(() => undefined);
  }, [chatId, sendMessage]);
}
