"use client";

import { useChat as useAIChat } from "@ai-sdk/react";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
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
