import { describe, expect, it } from "bun:test";

import type { DeployIntentContext } from "@/features/chat/persistence/deploy-intent-context";
import { buildDeployIntentQuery } from "@/features/deploy/deploy-intent-link";

import {
  consumeDeployIntentFromUrl,
  resetConsumedDeployIntentKeys,
} from "./use-deploy-intent-consumer";

const templateIntent: DeployIntentContext = {
  version: 1,
  kind: "template",
  source: "template-site",
  payload: { templateName: "glpi" },
};

describe("consumeDeployIntentFromUrl", () => {
  it("consumes a valid intent exactly once per chatId + raw value", () => {
    resetConsumedDeployIntentKeys();
    const query = buildDeployIntentQuery(templateIntent);
    const search = `?${query}`;

    const first = consumeDeployIntentFromUrl({ chatId: "chat-1", search });
    expect(first).toEqual({ intent: templateIntent, present: true });

    // Strict Mode / remount with the same chatId must not re-consume.
    const second = consumeDeployIntentFromUrl({ chatId: "chat-1", search });
    expect(second).toEqual({ intent: null, present: true });
  });

  it("does not consume for a different chatId", () => {
    resetConsumedDeployIntentKeys();
    const search = `?${buildDeployIntentQuery(templateIntent)}`;
    expect(
      consumeDeployIntentFromUrl({ chatId: "chat-1", search }).intent
    ).toEqual(templateIntent);
    expect(
      consumeDeployIntentFromUrl({ chatId: "chat-2", search }).intent
    ).toEqual(templateIntent);
  });

  it("reports present=true but intent=null for a malformed intent", () => {
    resetConsumedDeployIntentKeys();
    const result = consumeDeployIntentFromUrl({
      chatId: "chat-1",
      search: "?intent=not-encoded-json",
    });
    expect(result).toEqual({ intent: null, present: true });
  });

  it("reports present=false when no intent param exists", () => {
    resetConsumedDeployIntentKeys();
    expect(
      consumeDeployIntentFromUrl({
        chatId: "chat-1",
        search: "?side=skills-workflow",
      })
    ).toEqual({ intent: null, present: false });
  });
});
