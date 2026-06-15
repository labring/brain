"use client";

import { useChat as useAIChat } from "@ai-sdk/react";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { useAtomValue, useSetAtom } from "jotai";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSWRConfig } from "swr";
import { Chat } from "@/features/project-assistant/chat/chat";
import type { ChatHeaderThreadHistory } from "@/features/project-assistant/chat/chat.types";
import type { ProjectCanvasSelection } from "@/features/project-route-state/canvas-selection";
import {
  PROJECT_SELECTED_QUERY_KEY,
  parseProjectCanvasSelection,
} from "@/features/project-route-state/workbench-url-codec";
import {
  ProjectSidePaneProvider,
  useProjectSidePaneAssistantRouter,
} from "@/features/project-surfaces/react";
import { useCurrentProjectDisplayName } from "@/hooks/use-current-project-display-name";
import { useGithubAuth } from "@/hooks/use-github-auth";
import {
  appendAssistantThreadMessage,
  createAssistantThread,
  fetchAssistantSession,
  fetchAssistantThreadMessages,
  fetchAssistantThreads,
} from "@/lib/chat-persistence/client";
import type {
  AssistantContextPayload,
  AssistantSessionPayload,
  AssistantThreadDTO,
} from "@/lib/chat-persistence/types";
import {
  acknowledgePendingDeployTaskCreatedEvent,
  DEPLOY_TASK_CREATED_EVENT,
  type DeployTaskCreatedEvent,
  pendingDeployTaskCreatedEvents,
} from "@/lib/deploy-task/browser-events";
import {
  deployTaskDisplayEvents,
  summarizeDeployTaskError,
} from "@/lib/deploy-task/event-display";
import {
  NAVIGATE_APP_TOOL_NAME,
  type NavigateAppToolOutput,
  runNavigateAppTool,
} from "@/lib/tool/chat-navigate-app-tool";
import {
  OPEN_PROJECT_SURFACE_TOOL_NAME,
  type OpenProjectSurfaceToolOutput,
  runOpenProjectSurfaceTool,
} from "@/lib/tool/chat-open-project-surface-tool";
import {
  REFRESH_FRONTEND_SWR_TOOL_NAME,
  type RefreshFrontendSwrCachesToolOutput,
  runRefreshFrontendSwrCachesTool,
} from "@/lib/tool/chat-refresh-frontend-swr-tool";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import { assistantPaneOpenAtom } from "@/store/layout-store";

type AssistantClientToolSubmission =
  | {
      tool: typeof NAVIGATE_APP_TOOL_NAME;
      toolCallId: string;
      output: NavigateAppToolOutput;
    }
  | {
      tool: typeof REFRESH_FRONTEND_SWR_TOOL_NAME;
      toolCallId: string;
      output: RefreshFrontendSwrCachesToolOutput;
    }
  | {
      tool: typeof OPEN_PROJECT_SURFACE_TOOL_NAME;
      toolCallId: string;
      output: OpenProjectSurfaceToolOutput;
    };

const DEPLOY_TASK_STATUS_POLL_MS = 3000;
const DEPLOY_TASK_CHAT_MESSAGE_ID_PREFIX = "deploy-task-created-";
const DEPLOY_TASK_FALLBACK_PROJECT_RE = /Project:\s*`([^`]+)`/;
const DEPLOY_TASK_FALLBACK_REPO_RE = /created for \*\*([^*]+)\*\*/;
const TERMINAL_DEPLOY_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);

interface DeployTaskStatusSnapshot {
  events?: {
    message: string | null;
    phase: string | null;
    seq: number;
  }[];
  task?: {
    error?: string | null;
    phase?: string;
    source?: {
      kind?: string;
      repo?: {
        fullName?: string;
      };
    };
    status?: string;
  };
}

interface GithubDeployTaskPart {
  data: {
    error?: string | null;
    events?: { message: string | null; phase: string | null; seq: number }[];
    phase?: string;
    projectName: string;
    repoFullName: string;
    status?: string;
    taskId: string;
  };
  type: "data-github-deploy-task";
}

function isGithubDeployTaskPart(
  part: UIMessage["parts"][number]
): part is GithubDeployTaskPart {
  if (part.type !== "data-github-deploy-task") {
    return false;
  }
  const data = (part as { data?: unknown }).data;
  if (data == null || typeof data !== "object") {
    return false;
  }
  const record = data as Partial<GithubDeployTaskPart["data"]>;
  return (
    typeof record.projectName === "string" &&
    typeof record.repoFullName === "string" &&
    typeof record.taskId === "string"
  );
}

function deployTaskChatMessage(input: {
  error?: string | null;
  events?: { message: string | null; phase: string | null; seq: number }[];
  phase?: string;
  projectName: string;
  repoFullName: string;
  status?: string;
  taskId: string;
}): UIMessage {
  const events = deployTaskDisplayEvents(input.events, 3);
  const cardPart: GithubDeployTaskPart = {
    data: {
      error: input.error ?? null,
      events,
      phase: input.phase,
      projectName: input.projectName,
      repoFullName: input.repoFullName,
      status: input.status,
      taskId: input.taskId,
    },
    type: "data-github-deploy-task",
  };
  const statusLine =
    input.status == null
      ? "Status: queued"
      : `Status: ${input.status}${input.phase ? ` (${input.phase})` : ""}`;
  const latestEvent = events.at(-1);
  const eventLines =
    latestEvent == null
      ? []
      : [
          "",
          `Latest event: #${latestEvent.seq}${
            latestEvent.phase ? ` [${latestEvent.phase}]` : ""
          } ${latestEvent.message ?? "No details"}`,
        ];
  const summarizedError = summarizeDeployTaskError(input.error);
  const errorLines = summarizedError ? ["", `Error: ${summarizedError}`] : [];

  return {
    id: `${DEPLOY_TASK_CHAT_MESSAGE_ID_PREFIX}${input.taskId}`,
    role: "assistant",
    parts: [
      cardPart,
      {
        type: "text",
        text: [
          `GitHub deployment task **${input.taskId}** has been created for **${input.repoFullName}**.`,
          "",
          `Project: \`${input.projectName}\``,
          "",
          statusLine,
          ...eventLines,
          ...errorLines,
        ].join("\n"),
      },
    ],
  };
}

function deployTaskIdFromChatMessage(message: UIMessage): string | null {
  return message.id.startsWith(DEPLOY_TASK_CHAT_MESSAGE_ID_PREFIX)
    ? message.id.slice(DEPLOY_TASK_CHAT_MESSAGE_ID_PREFIX.length)
    : null;
}

function deployTaskDetailFromChatMessage(
  message: UIMessage
): DeployTaskCreatedEvent["detail"] | null {
  for (const part of message.parts) {
    if (isGithubDeployTaskPart(part)) {
      return {
        projectName: part.data.projectName,
        repoFullName: part.data.repoFullName,
        taskId: part.data.taskId,
      };
    }
  }

  const taskId = deployTaskIdFromChatMessage(message);
  if (taskId == null) {
    return null;
  }
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const repoMatch = text.match(DEPLOY_TASK_FALLBACK_REPO_RE);
  const projectMatch = text.match(DEPLOY_TASK_FALLBACK_PROJECT_RE);
  if (repoMatch == null || projectMatch == null) {
    return null;
  }
  const repoFullName = repoMatch[1]?.trim();
  const projectName = projectMatch[1]?.trim();
  if (!(repoFullName && projectName)) {
    return null;
  }
  return { projectName, repoFullName, taskId };
}

function deployTaskStatusUrl(input: {
  kubeconfig: string;
  namespace: string;
  taskId: string;
}): string {
  const params = new URLSearchParams({
    encodedKubeconfig: encodeURIComponent(input.kubeconfig),
    namespace: input.namespace,
  });
  return `/api/deploy-tasks/${encodeURIComponent(input.taskId)}?${params.toString()}`;
}

async function fetchDeployTaskStatusSnapshot(input: {
  kubeconfig: string;
  namespace: string;
  signal: AbortSignal;
  taskId: string;
}): Promise<DeployTaskStatusSnapshot> {
  const response = await fetch(deployTaskStatusUrl(input), {
    cache: "no-store",
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(`Deploy task status returned ${response.status}`);
  }
  return (await response.json()) as DeployTaskStatusSnapshot;
}

function deployTaskIsTerminal(snapshot: DeployTaskStatusSnapshot): boolean {
  return (
    snapshot.task?.status != null &&
    TERMINAL_DEPLOY_TASK_STATUSES.has(snapshot.task.status)
  );
}

function waitForDeployTaskPollDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, DEPLOY_TASK_STATUS_POLL_MS);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

function logDeployTaskPollError(input: {
  error: unknown;
  signal: AbortSignal;
}) {
  if (!input.signal.aborted) {
    console.error("[deploy-task-chat-adapter] poll failed:", input.error);
  }
}

function repoFullNameForDeployTask(
  snapshot: DeployTaskStatusSnapshot,
  fallback: string
): string {
  return snapshot.task?.source?.kind === "github"
    ? (snapshot.task.source.repo?.fullName ?? fallback)
    : fallback;
}

async function pollDeployTaskStatus(input: {
  detail: DeployTaskCreatedEvent["detail"];
  kubeconfig: string;
  namespace: string;
  signal: AbortSignal;
  upsertMessage: (message: UIMessage) => void;
}) {
  while (!input.signal.aborted) {
    try {
      const snapshot = await fetchDeployTaskStatusSnapshot({
        kubeconfig: input.kubeconfig,
        namespace: input.namespace,
        signal: input.signal,
        taskId: input.detail.taskId,
      });
      input.upsertMessage(
        deployTaskChatMessage({
          ...input.detail,
          error: snapshot.task?.error ?? null,
          events: snapshot.events,
          phase: snapshot.task?.phase,
          repoFullName: repoFullNameForDeployTask(
            snapshot,
            input.detail.repoFullName
          ),
          status: snapshot.task?.status,
        })
      );

      if (deployTaskIsTerminal(snapshot)) {
        return;
      }
    } catch (error) {
      logDeployTaskPollError({ error, signal: input.signal });
    }

    await waitForDeployTaskPollDelay(input.signal);
  }
}

function buildAssistantContextPayload(
  projectName: string | undefined,
  projectId: string,
  selected: ProjectCanvasSelection | null
): AssistantContextPayload | undefined {
  const pn = projectName?.trim() ?? "";
  const pu = projectId.trim();
  const target = selected?.kind === "edge" ? null : selected?.target;
  if (pn === "" && pu === "" && target == null) {
    return undefined;
  }
  return {
    ...(pn === "" ? {} : { projectName: pn }),
    ...(pu === "" ? {} : { projectId: pu }),
    ...(target == null
      ? {}
      : {
          selectedWorkload:
            target.kind === "PublicAccess"
              ? {
                  kind: target.kind,
                  name: target.apName,
                  namespace: target.namespace,
                }
              : {
                  kind: target.kind,
                  name: target.name,
                  namespace: target.namespace,
                },
        }),
  };
}

function ProjectAssistantChatSession({
  bootstrap,
  creatingThread,
  threads,
  assistantNamespaceRaw,
  onAssistantStreamFinished,
  onDatabaseIntent,
  onDockerIntent,
  onCreateThread,
  onGithubIntent,
  onSelectThread,
  onSkillsIntent,
}: {
  bootstrap: Pick<AssistantSessionPayload, "chatId" | "messages">;
  creatingThread: boolean;
  threads: AssistantThreadDTO[];
  assistantNamespaceRaw: string;
  onAssistantStreamFinished?: () => Promise<void>;
  onDatabaseIntent: () => void;
  onDockerIntent: () => void;
  onCreateThread: () => Promise<void>;
  onGithubIntent: () => void;
  onSelectThread: (threadId: string) => Promise<void>;
  onSkillsIntent: () => void;
}) {
  const router = useRouter();
  const projectSurfaceRouter = useProjectSidePaneAssistantRouter();
  const { mutate: revalidateScopeSwr } = useSWRConfig();
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  const chatId = bootstrap.chatId;
  const addToolOutputRef = useRef<
    ((args: AssistantClientToolSubmission) => void | PromiseLike<void>) | null
  >(null);
  const deployTaskAbortControllersRef = useRef<Map<string, AbortController>>(
    new Map()
  );
  const trackedDeployTaskIdsRef = useRef<Set<string>>(new Set());

  const params = useParams<{ uid?: string }>();
  const projectId = decodeURIComponent(params.uid ?? "");
  const currentProject = useCurrentProjectDisplayName({
    kubeconfig,
    namespace,
    projectId,
  });
  const [selectedQuery] = useQueryState(
    PROJECT_SELECTED_QUERY_KEY,
    parseAsString
  );
  const selected = useMemo(
    () => parseProjectCanvasSelection(selectedQuery),
    [selectedQuery]
  );

  // Keep a live ref so the transport memo stays stable across URL changes.
  const wireRef = useRef({
    namespace: assistantNamespaceRaw,
    projectId,
    selected,
  });
  wireRef.current = {
    namespace: assistantNamespaceRaw,
    projectId,
    selected,
  };

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({
          api,
          body,
          credentials,
          headers,
          id,
          messages,
        }) => {
          const last = messages.at(-1);
          if (last == null) {
            throw new Error("Assistant chat: no message to send");
          }
          const wire = wireRef.current;
          const assistantContext = buildAssistantContextPayload(
            currentProject.resourceName,
            wire.projectId,
            wire.selected
          );

          return {
            api,
            credentials,
            headers,
            body: {
              ...(body && typeof body === "object" ? body : {}),
              ...(assistantContext == null ? {} : { assistantContext }),
              chatId: id,
              encodedKubeconfig: encodeURIComponent(kubeconfig),
              message: last,
              namespace: wire.namespace,
            },
          };
        },
      }),
    [currentProject.resourceName, kubeconfig]
  );

  const {
    addToolApprovalResponse,
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    addToolOutput,
  } = useAIChat({
    id: chatId,
    messages: bootstrap.messages,
    transport,
    sendAutomaticallyWhen: ({ messages: nextMessages }) =>
      lastAssistantMessageIsCompleteWithToolCalls({
        messages: nextMessages,
      }) ||
      lastAssistantMessageIsCompleteWithApprovalResponses({
        messages: nextMessages,
      }),
    async onFinish() {
      await onAssistantStreamFinished?.();
    },
    onToolCall({ toolCall }) {
      if (toolCall.toolName === NAVIGATE_APP_TOOL_NAME) {
        const result = runNavigateAppTool(toolCall.input, router.push);
        const submit = addToolOutputRef.current;
        if (submit == null) {
          return;
        }
        Promise.resolve(
          submit({
            tool: NAVIGATE_APP_TOOL_NAME,
            toolCallId: toolCall.toolCallId,
            output: result,
          })
        ).catch((err: unknown) => {
          console.error("[navigateApp] addToolOutput failed:", err);
        });
        return;
      }

      if (toolCall.toolName === OPEN_PROJECT_SURFACE_TOOL_NAME) {
        const submit = addToolOutputRef.current;
        runOpenProjectSurfaceTool(toolCall.input, projectSurfaceRouter)
          .then((output) => {
            if (submit == null) {
              return;
            }
            Promise.resolve(
              submit({
                tool: OPEN_PROJECT_SURFACE_TOOL_NAME,
                toolCallId: toolCall.toolCallId,
                output,
              })
            ).catch((err: unknown) => {
              console.error("[openProjectSurface] addToolOutput failed:", err);
            });
          })
          .catch((err: unknown) => {
            console.error("[openProjectSurface] routing failed:", err);
          });
        return;
      }

      if (toolCall.toolName !== REFRESH_FRONTEND_SWR_TOOL_NAME) {
        return;
      }
      const submitRefresh = addToolOutputRef.current;
      runRefreshFrontendSwrCachesTool(revalidateScopeSwr, toolCall.input)
        .then((output) => {
          if (submitRefresh == null) {
            return;
          }
          Promise.resolve(
            submitRefresh({
              tool: REFRESH_FRONTEND_SWR_TOOL_NAME,
              toolCallId: toolCall.toolCallId,
              output,
            })
          ).catch((err: unknown) => {
            console.error(
              "[refreshFrontendSwrCaches] addToolOutput failed:",
              err
            );
          });
        })
        .catch((err: unknown) => {
          console.error("[refreshFrontendSwrCaches] mutation failed:", err);
        });
    },
  });

  // console.log("messages", messages);

  addToolOutputRef.current = addToolOutput;
  const persistDeployTaskMessage = useCallback(
    (message: UIMessage) => {
      appendAssistantThreadMessage({
        chatId,
        message,
        namespace: assistantNamespaceRaw,
      })
        .then((result) => {
          const taskId = deployTaskIdFromChatMessage(message);
          if (result?.ok && taskId != null) {
            acknowledgePendingDeployTaskCreatedEvent(taskId);
          }
        })
        .catch((error: unknown) => {
          console.error("[deploy-task-chat-adapter] persist failed:", error);
        });
    },
    [assistantNamespaceRaw, chatId]
  );

  const upsertDeployTaskMessage = useCallback(
    (message: UIMessage) => {
      setMessages((current) => {
        const index = current.findIndex((item) => item.id === message.id);
        if (index === -1) {
          return [...current, message];
        }
        const next = [...current];
        next[index] = message;
        return next;
      });
      persistDeployTaskMessage(message);
    },
    [persistDeployTaskMessage, setMessages]
  );

  const trackDeployTask = useCallback(
    (detail: DeployTaskCreatedEvent["detail"]): void => {
      if (trackedDeployTaskIdsRef.current.has(detail.taskId)) {
        return;
      }
      trackedDeployTaskIdsRef.current.add(detail.taskId);
      const controller = new AbortController();
      deployTaskAbortControllersRef.current.set(detail.taskId, controller);

      pollDeployTaskStatus({
        detail,
        kubeconfig,
        namespace: assistantNamespaceRaw,
        signal: controller.signal,
        upsertMessage: upsertDeployTaskMessage,
      }).catch((error: unknown) => {
        logDeployTaskPollError({ error, signal: controller.signal });
      });
    },
    [assistantNamespaceRaw, kubeconfig, upsertDeployTaskMessage]
  );

  const showDeployTaskCreated = useCallback(
    (detail: DeployTaskCreatedEvent["detail"]) => {
      if (
        detail == null ||
        typeof detail.taskId !== "string" ||
        typeof detail.repoFullName !== "string" ||
        typeof detail.projectName !== "string"
      ) {
        return;
      }

      const message = deployTaskChatMessage(detail);
      upsertDeployTaskMessage(message);
      trackDeployTask(detail);
    },
    [trackDeployTask, upsertDeployTaskMessage]
  );

  useEffect(() => {
    const onDeployTaskCreated = (event: Event) => {
      showDeployTaskCreated((event as DeployTaskCreatedEvent).detail);
    };

    for (const pending of pendingDeployTaskCreatedEvents()) {
      showDeployTaskCreated(pending);
    }
    window.addEventListener(DEPLOY_TASK_CREATED_EVENT, onDeployTaskCreated);
    return () => {
      window.removeEventListener(
        DEPLOY_TASK_CREATED_EVENT,
        onDeployTaskCreated
      );
      for (const controller of deployTaskAbortControllersRef.current.values()) {
        controller.abort();
      }
      deployTaskAbortControllersRef.current.clear();
      trackedDeployTaskIdsRef.current.clear();
    };
  }, [showDeployTaskCreated]);

  useEffect(() => {
    for (const message of messages) {
      const detail = deployTaskDetailFromChatMessage(message);
      if (detail != null) {
        trackDeployTask(detail);
      }
    }
  }, [messages, trackDeployTask]);
  const [input, setInput] = useState("");
  const { isAuthorized, isLoading: authLoading } = useGithubAuth();

  const createThreadClicked = useCallback(() => {
    onCreateThread().catch(() => undefined);
  }, [onCreateThread]);

  const threadHistory = useMemo((): ChatHeaderThreadHistory | undefined => {
    if (threads.length === 0) {
      return undefined;
    }
    return {
      activeThreadId: chatId,
      items: threads.map((t) => ({
        id: t.id,
        title: t.title,
        updatedAt: new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(t.updatedAt)),
        updatedAtSource: t.updatedAt,
      })),
      onSelect: (threadId: string) => {
        onSelectThread(threadId).catch(() => undefined);
      },
    };
  }, [threads, chatId, onSelectThread]);

  const threadLabel = useMemo(() => {
    const hit = threads.find((t) => t.id === chatId);
    return hit?.title ?? "Assistant";
  }, [threads, chatId]);

  const busy = status === "submitted" || status === "streaming";

  const composerContextToggles = useMemo(() => {
    const toggles: string[] = [];
    if (projectId.trim() !== "") {
      toggles.push("Current Project");
    }
    if (selected != null && selected.kind !== "edge") {
      toggles.push("Current Service");
    }
    return toggles;
  }, [projectId, selected]);

  const onPrimaryAction = useCallback(() => {
    if (busy) {
      stop();
      return;
    }
    const text = input.trim();
    if (!text) {
      return;
    }
    sendMessage({ text }).catch(() => undefined);
    setInput("");
  }, [busy, input, sendMessage, stop]);

  return (
    <Chat.Root>
      <Chat className="h-full min-h-0 flex-1 border-0 shadow-none">
        <Chat.Header
          className="shrink-0 py-2 pr-12"
          threadHistory={threadHistory}
          threadName={threadLabel}
        >
          <Chat.NewThread
            aria-label="Create thread"
            className="size-9"
            creating={creatingThread}
            onNewThread={createThreadClicked}
          />
        </Chat.Header>
        <Chat.Transcript
          addToolApprovalResponse={addToolApprovalResponse}
          className="min-h-0 flex-1"
          messages={messages}
          status={status}
        />
        <div className="group flex w-full shrink-0 flex-col p-2 pt-4">
          <div className="relative isolate w-full">
            {composerContextToggles.length > 0 ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 w-full -translate-y-full">
                <Chat.ContextIndicator
                  className="w-full"
                  contextToggles={composerContextToggles}
                />
              </div>
            ) : null}
            <Chat.ComposerShell>
              <Chat.ComposerTextarea
                onPrimaryAction={onPrimaryAction}
                onValueChange={setInput}
                placeholder="Message…"
                responding={busy}
                value={input}
              />
              <Chat.ComposerFooter>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <Chat.GithubDeployButton
                    authLoading={authLoading}
                    isAuthorized={isAuthorized}
                    onComposerAction={onGithubIntent}
                  />
                  <Chat.SkillsWorkflowButton
                    onComposerAction={onSkillsIntent}
                  />
                  <Chat.DockerDeployButton onComposerAction={onDockerIntent} />
                  <Chat.DatabaseDeployButton
                    onComposerAction={onDatabaseIntent}
                  />
                </div>
                <Chat.ComposerSend
                  onPrimaryAction={onPrimaryAction}
                  responding={busy}
                  value={input}
                />
              </Chat.ComposerFooter>
            </Chat.ComposerShell>
          </div>
        </div>
      </Chat>
    </Chat.Root>
  );
}

function ProjectAssistantChatPane() {
  const namespaceRaw = useAtomValue(namespaceAtom);
  const sidePaneRouter = useProjectSidePaneAssistantRouter();
  const [creatingThread, setCreatingThread] = useState(false);
  const [session, setSession] = useState<AssistantSessionPayload | null>(null);
  const [sessionError, setSessionError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setSessionError(false);

    fetchAssistantSession(namespaceRaw).then((payload) => {
      if (cancelled) {
        return;
      }
      if (payload == null) {
        setSessionError(true);
        return;
      }
      setSession(payload);
    });

    return () => {
      cancelled = true;
    };
  }, [namespaceRaw]);

  const selectThread = useCallback(
    async (threadId: string) => {
      if (threadId === session?.chatId) {
        return;
      }
      const messages = await fetchAssistantThreadMessages(
        threadId,
        namespaceRaw
      );
      if (messages == null) {
        return;
      }
      setSession((prev) =>
        prev == null ? prev : { ...prev, chatId: threadId, messages }
      );
    },
    [namespaceRaw, session?.chatId]
  );

  const createThread = useCallback(async () => {
    setCreatingThread(true);
    try {
      const created = await createAssistantThread(namespaceRaw);
      if (created == null) {
        return;
      }
      setSession({
        chatId: created.chatId,
        messages: [],
        threads: created.threads,
      });
    } finally {
      setCreatingThread(false);
    }
  }, [namespaceRaw]);

  const refreshThreads = useCallback(async () => {
    const threads = await fetchAssistantThreads(namespaceRaw);
    if (threads == null || threads.length === 0) {
      return;
    }
    setSession((prev) => (prev == null ? prev : { ...prev, threads }));
  }, [namespaceRaw]);

  const openGithubIntent = useCallback(() => {
    sidePaneRouter
      .openAssistantIntent({ type: "github" })
      .catch(() => undefined);
  }, [sidePaneRouter]);
  const openDatabaseIntent = useCallback(() => {
    sidePaneRouter
      .openAssistantIntent({ type: "database" })
      .catch(() => undefined);
  }, [sidePaneRouter]);
  const openDockerIntent = useCallback(() => {
    sidePaneRouter
      .openAssistantIntent({ type: "docker" })
      .catch(() => undefined);
  }, [sidePaneRouter]);
  const openSkillsIntent = useCallback(() => {
    sidePaneRouter
      .openAssistantIntent({ type: "skills" })
      .catch(() => undefined);
  }, [sidePaneRouter]);

  if (sessionError) {
    return (
      <div
        className="project-chrome-surface flex h-full min-h-0 flex-1 items-center justify-center p-4 text-center text-muted-foreground text-sm"
        data-slot="assistant-chat-error"
      >
        Could not load assistant chat. Check DATABASE_URL and database
        migrations, then refresh.
      </div>
    );
  }

  if (session === null) {
    return (
      <div
        aria-busy
        className="project-chrome-surface h-full min-h-0 flex-1"
        data-slot="assistant-chat-boot"
      />
    );
  }

  return (
    <ProjectAssistantChatSession
      assistantNamespaceRaw={namespaceRaw}
      bootstrap={session}
      creatingThread={creatingThread}
      key={session.chatId}
      onAssistantStreamFinished={refreshThreads}
      onCreateThread={createThread}
      onDatabaseIntent={openDatabaseIntent}
      onDockerIntent={openDockerIntent}
      onGithubIntent={openGithubIntent}
      onSelectThread={selectThread}
      onSkillsIntent={openSkillsIntent}
      threads={session.threads}
    />
  );
}

function ProjectRouteTopBar({
  assistantPaneOpen,
}: {
  assistantPaneOpen: boolean;
}) {
  const params = useParams<{ uid?: string }>();
  const projectId = decodeURIComponent(params.uid ?? "");
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  const currentProject = useCurrentProjectDisplayName({
    kubeconfig,
    namespace,
    projectId,
  });
  const showProjectName = projectId.trim() !== "";

  return (
    <header
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-10 flex h-13 items-center gap-2 bg-[#09090B]/10 pr-2 pl-6 backdrop-blur-lg",
        !assistantPaneOpen && "pr-12"
      )}
    >
      <div className="min-w-0 flex-1">
        {showProjectName && currentProject.isLoading ? (
          <Skeleton className="h-5 w-36 max-w-full" />
        ) : null}
        {showProjectName && !currentProject.isLoading ? (
          <h1 className="truncate font-medium text-foreground text-sm">
            {currentProject.displayName ?? "Project"}
          </h1>
        ) : null}
      </div>
    </header>
  );
}

/** Main project column + optional Project Assistant Pane (`POST /api/chat` + AI SDK). */
function ProjectWorkspaceLayoutContent({ children }: { children: ReactNode }) {
  const assistantPaneOpen = useAtomValue(assistantPaneOpenAtom);
  const setAssistantPaneOpen = useSetAtom(assistantPaneOpenAtom);
  const toggleAssistantPane = useCallback(() => {
    setAssistantPaneOpen((open) => !open);
  }, [setAssistantPaneOpen]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
      <section
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-slot="project-main-pane"
      >
        <ProjectRouteTopBar assistantPaneOpen={assistantPaneOpen} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </section>
      <aside
        aria-hidden={!assistantPaneOpen}
        className={cn(
          "project-chrome-surface box-border flex min-h-0 shrink-0 flex-col overflow-hidden border-l transition-[width,min-width,opacity,transform,border-color] duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none",
          assistantPaneOpen
            ? "w-104 min-w-104 translate-x-0 border-border opacity-100"
            : "pointer-events-none w-0 min-w-0 translate-x-4 border-transparent opacity-0"
        )}
        data-slot="project-assistant-pane"
        id="project-assistant-pane"
      >
        <ProjectAssistantChatPane />
      </aside>
      <AppIconButton
        aria-controls="project-assistant-pane"
        aria-expanded={assistantPaneOpen}
        aria-label={
          assistantPaneOpen ? "Close assistant pane" : "Open assistant pane"
        }
        className="absolute top-2 right-2 z-40"
        onClick={toggleAssistantPane}
        size="lg"
        type="button"
        variant="quiet"
      >
        {assistantPaneOpen ? (
          <PanelRightClose aria-hidden className="size-4" strokeWidth={2} />
        ) : (
          <PanelRightOpen aria-hidden className="size-4" strokeWidth={2} />
        )}
      </AppIconButton>
    </div>
  );
}

export default function ProjectWorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ProjectSidePaneProvider>
      <ProjectWorkspaceLayoutContent>{children}</ProjectWorkspaceLayoutContent>
    </ProjectSidePaneProvider>
  );
}
