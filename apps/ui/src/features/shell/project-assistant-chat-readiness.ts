export function isAssistantChatNamespaceReady(namespaceRaw: string): boolean {
  return namespaceRaw.trim() !== "";
}

export function isAssistantChatCredentialsReady(input: {
  appToken: string;
  kubeconfig: string;
  namespace: string;
}): boolean {
  return (
    isAssistantChatNamespaceReady(input.namespace) &&
    input.kubeconfig.trim() !== "" &&
    input.appToken.trim() !== ""
  );
}

export type AssistantChatBootstrapState =
  | "credentials"
  | "error"
  | "loading"
  | "ready";

export function assistantChatBootstrapState(input: {
  credentialsReady: boolean;
  session: unknown;
  sessionError: boolean;
}): AssistantChatBootstrapState {
  if (!input.credentialsReady) {
    return "credentials";
  }
  if (input.sessionError) {
    return "error";
  }
  if (input.session == null) {
    return "loading";
  }
  return "ready";
}
