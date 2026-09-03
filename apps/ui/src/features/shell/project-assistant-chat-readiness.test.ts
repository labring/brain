import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assistantChatBootstrapState,
  isAssistantChatCredentialsReady,
  isAssistantChatNamespaceReady,
} from "./project-assistant-chat-readiness";

test("assistant chat waits for a non-empty namespace before bootstrapping", () => {
  assert.equal(isAssistantChatNamespaceReady(""), false);
  assert.equal(isAssistantChatNamespaceReady("   "), false);
  assert.equal(isAssistantChatNamespaceReady("ns-demo"), true);
  assert.equal(isAssistantChatNamespaceReady(" ns-demo "), true);
});

test("assistant chat waits for all workspace credentials", () => {
  const credentials = {
    appToken: "app-token",
    kubeconfig: "encoded-kubeconfig",
    namespace: "ns-demo",
  };
  assert.equal(isAssistantChatCredentialsReady(credentials), true);
  assert.equal(
    isAssistantChatCredentialsReady({ ...credentials, appToken: " " }),
    false
  );
  assert.equal(
    isAssistantChatCredentialsReady({ ...credentials, kubeconfig: " " }),
    false
  );
  assert.equal(
    isAssistantChatCredentialsReady({ ...credentials, namespace: " " }),
    false
  );
});

test("assistant chat bootstrap state never represents missing credentials as a blank boot", () => {
  assert.equal(
    assistantChatBootstrapState({
      credentialsReady: false,
      session: null,
      sessionError: false,
    }),
    "credentials"
  );
  assert.equal(
    assistantChatBootstrapState({
      credentialsReady: true,
      session: null,
      sessionError: false,
    }),
    "loading"
  );
  assert.equal(
    assistantChatBootstrapState({
      credentialsReady: true,
      session: null,
      sessionError: true,
    }),
    "error"
  );
});
