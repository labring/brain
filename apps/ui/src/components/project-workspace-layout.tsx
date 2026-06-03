"use client";

import { useChat as useAIChat } from "@ai-sdk/react";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Chat,
  downloadChatMessagesJson,
} from "@workspace/ui/components/chat/chat";
import type { ChatHeaderThreadHistory } from "@workspace/ui/components/chat/chat.types";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import {
  DefaultChatTransport,
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
  consumePendingDeployTaskCreatedEvents,
  DEPLOY_TASK_CREATED_EVENT,
  type DeployTaskCreatedEvent,
} from "@/lib/deploy-task/browser-events";
import {
  NAVIGATE_APP_TOOL_NAME,
  type NavigateAppToolOutput,
  runNavigateAppTool,
} from "@/lib/tool/chat-navigate-app-tool";
import {
  REFRESH_FRONTEND_SWR_TOOL_NAME,
  type RefreshFrontendSwrCachesToolOutput,
  runRefreshFrontendSwrCachesTool,
} from "@/lib/tool/chat-refresh-frontend-swr-tool";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import { assistantPaneOpenAtom } from "@/store/layout-store";

const DEPLOY_TASK_STATUS_POLL_MS = 3000;
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
    status?: string;
  };
}

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
    };

function deployTaskChatMessage(input: {
  error?: string | null;
  events?: { message: string | null; phase: string | null; seq: number }[];
  phase?: string;
  projectName: string;
  repoFullName: string;
  status?: string;
  taskId: string;
}): UIMessage {
  const events = input.events?.slice(-6) ?? [];
  const statusLine =
    input.status == null
      ? "Status: queued"
      : `Status: ${input.status}${input.phase ? ` (${input.phase})` : ""}`;
  const eventLines =
    events.length === 0
      ? []
      : [
          "",
          "Recent events:",
          ...events.map((event) => {
            const phase = event.phase ? ` [${event.phase}]` : "";
            return `- #${event.seq}${phase} ${event.message ?? "No details"}`;
          }),
        ];
  const errorLines = input.error ? ["", `Error: ${input.error}`] : [];

  return {
    id: `deploy-task-created-${input.taskId}`,
    role: "assistant",
    parts: [
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

function buildAssistantContextPayload(
  projectName: string | undefined,
  projectUid: string,
  selected: ProjectCanvasSelection | null
): AssistantContextPayload | undefined {
  const pn = projectName?.trim() ?? "";
  const pu = projectUid.trim();
  const target = selected?.kind === "edge" ? null : selected?.target;
  if (pn === "" && pu === "" && target == null) {
    return undefined;
  }
  return {
    ...(pn === "" ? {} : { projectName: pn }),
    ...(pu === "" ? {} : { projectUid: pu }),
    ...(target == null
      ? {}
      : {
          selectedWorkload:
            target.kind === "EntryPoint"
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
}) {
  const router = useRouter();
  const { mutate: revalidateScopeSwr } = useSWRConfig();
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  const chatId = bootstrap.chatId;
  const addToolOutputRef = useRef<
    ((args: AssistantClientToolSubmission) => void | PromiseLike<void>) | null
  >(null);

  const params = useParams<{ uid?: string }>();
  const projectUid = decodeURIComponent(params.uid ?? "");
  const currentProject = useCurrentProjectDisplayName({
    kubeconfig,
    namespace,
    projectUid,
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
    projectUid,
    selected,
  });
  wireRef.current = {
    namespace: assistantNamespaceRaw,
    projectUid,
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
            wire.projectUid,
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

  const { messages, sendMessage, setMessages, status, stop, addToolOutput } =
    useAIChat({
      id: chatId,
      messages: bootstrap.messages,
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
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
  useEffect(() => {
    const trackedTaskIds = new Set<string>();
    const abortControllers = new Map<string, AbortController>();

    const persistMessage = (message: UIMessage) => {
      appendAssistantThreadMessage({
        chatId,
        message,
        namespace: assistantNamespaceRaw,
      }).catch((error: unknown) => {
        console.error("[deploy-task-chat-adapter] persist failed:", error);
      });
    };

    const upsertMessage = (message: UIMessage) => {
      setMessages((current) => {
        const index = current.findIndex((item) => item.id === message.id);
        if (index === -1) {
          return [...current, message];
        }
        const next = [...current];
        next[index] = message;
        return next;
      });
      persistMessage(message);
    };

    const trackDeployTask = (
      detail: DeployTaskCreatedEvent["detail"]
    ): void => {
      if (trackedTaskIds.has(detail.taskId)) {
        return;
      }
      trackedTaskIds.add(detail.taskId);
      const controller = new AbortController();
      abortControllers.set(detail.taskId, controller);

      const poll = async (): Promise<void> => {
        while (!controller.signal.aborted) {
          try {
            const snapshot = await fetchDeployTaskStatusSnapshot({
              kubeconfig,
              namespace: assistantNamespaceRaw,
              signal: controller.signal,
              taskId: detail.taskId,
            });
            const message = deployTaskChatMessage({
              ...detail,
              error: snapshot.task?.error ?? null,
              events: snapshot.events,
              phase: snapshot.task?.phase,
              status: snapshot.task?.status,
            });
            upsertMessage(message);

            if (deployTaskIsTerminal(snapshot)) {
              return;
            }
          } catch (error) {
            logDeployTaskPollError({ error, signal: controller.signal });
          }

          await waitForDeployTaskPollDelay(controller.signal);
        }
      };

      poll().catch((error: unknown) => {
        logDeployTaskPollError({ error, signal: controller.signal });
      });
    };

    const showDeployTaskCreated = (
      detail: DeployTaskCreatedEvent["detail"]
    ) => {
      if (
        detail == null ||
        typeof detail.taskId !== "string" ||
        typeof detail.repoFullName !== "string" ||
        typeof detail.projectName !== "string"
      ) {
        return;
      }

      const message = deployTaskChatMessage(detail);
      upsertMessage(message);
      trackDeployTask(detail);
    };

    const onDeployTaskCreated = (event: Event) => {
      showDeployTaskCreated((event as DeployTaskCreatedEvent).detail);
    };

    for (const pending of consumePendingDeployTaskCreatedEvents()) {
      showDeployTaskCreated(pending);
    }
    window.addEventListener(DEPLOY_TASK_CREATED_EVENT, onDeployTaskCreated);
    return () => {
      window.removeEventListener(
        DEPLOY_TASK_CREATED_EVENT,
        onDeployTaskCreated
      );
      for (const controller of abortControllers.values()) {
        controller.abort();
      }
    };
  }, [assistantNamespaceRaw, chatId, kubeconfig, setMessages]);
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
    if (projectUid.trim() !== "") {
      toggles.push("Current Project");
    }
    if (selected != null && selected.kind !== "edge") {
      toggles.push("Current Service");
    }
    return toggles;
  }, [projectUid, selected]);

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

  const exportTranscript = useCallback(() => {
    downloadChatMessagesJson(messages, { fileNameStem: threadLabel });
  }, [messages, threadLabel]);

  return (
    <Chat.Root>
      <Chat className="h-full min-h-0 flex-1 border-0 bg-[#101219] shadow-none">
        <Chat.Header
          className="shrink-0 py-2 pr-12"
          threadHistory={threadHistory}
          threadName={threadLabel}
        >
          <Chat.Export
            className="size-9"
            disabled={messages.length === 0}
            onExport={exportTranscript}
          />
          <Chat.NewThread
            aria-label="Create thread"
            className="size-9"
            creating={creatingThread}
            onNewThread={createThreadClicked}
          />
        </Chat.Header>
        <Chat.Transcript
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

  if (sessionError) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#101219] p-4 text-center text-muted-foreground text-sm"
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
        className="h-full min-h-0 flex-1 bg-[#101219]"
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
  const projectUid = decodeURIComponent(params.uid ?? "");
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  const currentProject = useCurrentProjectDisplayName({
    kubeconfig,
    namespace,
    projectUid,
  });
  const showProjectName = projectUid.trim() !== "";

  return (
    <header
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-10 flex h-13 items-center gap-2 bg-transparent pr-2 pl-6",
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
          "box-border flex min-h-0 shrink-0 flex-col overflow-hidden border-l bg-[#101219] transition-[width,min-width,opacity,transform,border-color] duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none",
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
