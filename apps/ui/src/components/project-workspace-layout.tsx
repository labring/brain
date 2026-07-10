"use client";

import { useChat as useAIChat } from "@ai-sdk/react";
import { fetcher } from "@workspace/api/fetch";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  SquarePen,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { isAssistantChatNamespaceReady } from "@/components/project-assistant-chat-readiness";
import { Chat } from "@/features/project-assistant/chat/chat";
import type { ChatHeaderThreadHistory } from "@/features/project-assistant/chat/chat.types";
import { FreeTurnsIndicator } from "@/features/project-assistant/free-turns-indicator";
import {
  type ProjectCanvasSelection,
  projectCanvasSelectionTarget,
} from "@/features/project-route-state/canvas-selection";
import {
  PROJECT_SELECTED_QUERY_KEY,
  parseProjectCanvasSelection,
} from "@/features/project-route-state/workbench-url-codec";
import {
  ProjectSidePaneProvider,
  useProjectSidePaneAssistantRouter,
} from "@/features/project-surfaces/react";
import {
  ProjectEditDialog,
  type ProjectEditDialogValues,
} from "@/features/projects/project-edit-dialog";
import { useCurrentProjectDisplayName } from "@/hooks/use-current-project-display-name";
import { useGithubAuth } from "@/hooks/use-github-auth";
import {
  ASSISTANT_PANE_DEFAULT_WIDTH,
  ASSISTANT_PANE_MIN_WIDTH,
  ASSISTANT_PANE_RESIZE_STEP,
  assistantPaneMaxWidth,
  clampAssistantPaneWidth,
  readStoredAssistantPaneWidth,
  writeStoredAssistantPaneWidth,
} from "@/lib/assistant-pane-width";
import type { BrainProjectResponse } from "@/lib/brain-projects";
import {
  createAssistantThread,
  fetchAssistantSession,
  fetchAssistantThreadMessages,
  fetchAssistantThreads,
} from "@/lib/chat-persistence/client";
import {
  type AssistantContextPayload,
  type AssistantSessionPayload,
  type AssistantThreadDTO,
  type FreeTierState,
  SELECTED_RESOURCE_CONTEXT_PART_TYPE,
  type SelectedResourceContext,
} from "@/lib/chat-persistence/types";
import { dispatchDeployTaskCreatedEvent } from "@/lib/deploy-task/browser-events";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import { errorDescription, toastErrorDetail } from "@/lib/toast-utils";
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
import {
  desktopUserIdAtom,
  kubeconfigAtom,
  namespaceAtom,
} from "@/store/auth-store";
import {
  assistantPaneOpenAtom,
  assistantPaneResizingAtom,
  assistantPaneWidthAtom,
} from "@/store/layout-store";

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

const VIEWPORT_RESIZE_SETTLE_MS = 180;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function deployTaskDetailFromCreateToolPart(
  part: UIMessage["parts"][number]
): { projectId: string; taskId: string } | null {
  if (
    !isToolUIPart(part) ||
    part.type !== "tool-createDeployTask" ||
    part.state !== "output-available"
  ) {
    return null;
  }

  const output = recordValue(part.output);
  if (output?.ok !== true) {
    return null;
  }
  const task = recordValue(output.task);
  const taskId = stringValue(task?.id);
  const projectId = stringValue(task?.projectId);
  if (projectId == null || taskId == null) {
    return null;
  }
  return {
    projectId,
    taskId,
  };
}

function buildAssistantContextPayload(
  projectName: string | undefined,
  projectId: string
): AssistantContextPayload | undefined {
  const pn = projectName?.trim() ?? "";
  const pu = projectId.trim();
  if (pn === "" && pu === "") {
    return undefined;
  }
  return {
    ...(pn === "" ? {} : { projectName: pn }),
    ...(pu === "" ? {} : { projectId: pu }),
  };
}

/**
 * Snapshot the resource selected on the canvas at send time. Pinned to the user
 * message so the model resolves "this"/"it" against what was selected then, not
 * whatever is selected on a later turn. `null` = nothing selected (no backfill).
 */
function buildSelectedResourceSnapshot(
  selected: ProjectCanvasSelection | null
): SelectedResourceContext | null {
  const target = projectCanvasSelectionTarget(selected);
  if (target == null) {
    return null;
  }
  return target.kind === "PublicAccess"
    ? { kind: target.kind, name: target.apName, namespace: target.namespace }
    : { kind: target.kind, name: target.name, namespace: target.namespace };
}

function ProjectAssistantComposer({
  busy,
  contextToggles,
  onDatabaseIntent,
  onDockerIntent,
  onGithubIntent,
  onSkillsIntent,
  onStop,
  onSubmit,
}: {
  busy: boolean;
  contextToggles: readonly string[];
  onDatabaseIntent: () => void;
  onDockerIntent: () => void;
  onGithubIntent: () => void;
  onSkillsIntent: () => void;
  onStop: () => void;
  onSubmit: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const { isAuthorized, isLoading: authLoading } = useGithubAuth();

  const onPrimaryAction = useCallback(() => {
    if (busy) {
      onStop();
      return;
    }
    const text = input.trim();
    if (!text) {
      return;
    }
    onSubmit(text);
    setInput("");
  }, [busy, input, onStop, onSubmit]);

  return (
    <div className="group flex w-full shrink-0 flex-col p-[10px]">
      {contextToggles.length > 0 ? (
        <div className="relative h-0 w-full overflow-visible transition-[height] duration-300 ease-out group-focus-within:h-6 motion-reduce:transition-none">
          <div className="pointer-events-none absolute inset-x-0 top-full w-full -translate-y-full">
            <Chat.ContextIndicator
              className="w-full"
              contextToggles={contextToggles}
            />
          </div>
        </div>
      ) : null}
      <Chat.ComposerShell>
        <Chat.ComposerTextarea
          onPrimaryAction={onPrimaryAction}
          onValueChange={setInput}
          placeholder="Ask SealAI to inspect, deploy, or explain this project..."
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
            <Chat.SkillsWorkflowButton onComposerAction={onSkillsIntent} />
            <Chat.DockerDeployButton onComposerAction={onDockerIntent} />
            <Chat.DatabaseDeployButton onComposerAction={onDatabaseIntent} />
          </div>
          <Chat.ComposerSend
            onPrimaryAction={onPrimaryAction}
            responding={busy}
            value={input}
          />
        </Chat.ComposerFooter>
      </Chat.ComposerShell>
    </div>
  );
}

const ProjectAssistantComposerMemo = memo(ProjectAssistantComposer);

function ProjectAssistantChatSession({
  bootstrap,
  freeTier,
  creatingThread,
  threads,
  assistantNamespaceRaw,
  onAssistantStreamFinished,
  onBillingHeaders,
  onDatabaseIntent,
  onDockerIntent,
  onCreateThread,
  onGithubIntent,
  onSelectThread,
  onSkillsIntent,
}: {
  bootstrap: Pick<AssistantSessionPayload, "chatId" | "messages">;
  freeTier: FreeTierState | null;
  creatingThread: boolean;
  threads: AssistantThreadDTO[];
  assistantNamespaceRaw: string;
  onAssistantStreamFinished?: () => Promise<void>;
  onBillingHeaders: (headers: Headers) => void;
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
  const bridgedToolDeployTaskIdsRef = useRef<Set<string>>(new Set());

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

  // Keep a live ref so the transport memo stays stable across URL changes. The
  // volatile canvas selection is pinned per-message (see submitComposerText), so
  // only thread-stable wire fields belong here.
  const wireRef = useRef({
    namespace: assistantNamespaceRaw,
    projectId,
  });
  wireRef.current = {
    namespace: assistantNamespaceRaw,
    projectId,
  };

  const billingHandlerRef = useRef(onBillingHeaders);
  billingHandlerRef.current = onBillingHeaders;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          billingHandlerRef.current(response.headers);
          return response;
        },
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
            currentProject.displayName,
            wire.projectId
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
    [currentProject.displayName, kubeconfig]
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

  addToolOutputRef.current = addToolOutput;

  useEffect(() => {
    const currentProjectId = projectId.trim();
    if (currentProjectId === "") {
      return;
    }
    for (const message of messages) {
      for (const part of message.parts) {
        const detail = deployTaskDetailFromCreateToolPart(part);
        if (
          detail == null ||
          detail.projectId !== currentProjectId ||
          bridgedToolDeployTaskIdsRef.current.has(detail.taskId)
        ) {
          continue;
        }
        bridgedToolDeployTaskIdsRef.current.add(detail.taskId);
        dispatchDeployTaskCreatedEvent(detail);
      }
    }
  }, [messages, projectId]);
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

  const submitComposerText = useCallback(
    (text: string) => {
      const snapshot = buildSelectedResourceSnapshot(selected);
      if (snapshot == null) {
        sendMessage({ text }).catch(() => undefined);
        return;
      }
      sendMessage({
        role: "user",
        parts: [
          { type: SELECTED_RESOURCE_CONTEXT_PART_TYPE, data: snapshot },
          { type: "text", text },
        ],
      }).catch(() => undefined);
    },
    [sendMessage, selected]
  );

  const stopComposerResponse = useCallback(() => {
    stop();
  }, [stop]);

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
        {freeTier?.billing === "free" ? (
          <div className="shrink-0 px-[10px] pt-1">
            <FreeTurnsIndicator
              limit={freeTier.limit}
              remaining={freeTier.remaining}
            />
          </div>
        ) : null}
        <ProjectAssistantComposerMemo
          busy={busy}
          contextToggles={composerContextToggles}
          onDatabaseIntent={onDatabaseIntent}
          onDockerIntent={onDockerIntent}
          onGithubIntent={onGithubIntent}
          onSkillsIntent={onSkillsIntent}
          onStop={stopComposerResponse}
          onSubmit={submitComposerText}
        />
      </Chat>
    </Chat.Root>
  );
}

function ProjectAssistantChatPane() {
  const namespaceRaw = useAtomValue(namespaceAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  // Owner tag for per-user thread partitioning (ADR 0047). Hydrated together with
  // kubeconfig/namespace in `applySealosSdkHydration`, so it is already set when
  // `namespaceReady` gates the fetch below; empty is the shared / dev bucket.
  const desktopUserId = useAtomValue(desktopUserIdAtom);
  const namespaceReady = isAssistantChatNamespaceReady(namespaceRaw);
  const sidePaneRouter = useProjectSidePaneAssistantRouter();
  const [creatingThread, setCreatingThread] = useState(false);
  const [session, setSession] = useState<AssistantSessionPayload | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const [freeTier, setFreeTier] = useState<FreeTierState | null>(null);
  const prevBillingRef = useRef<"free" | "user" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setSessionError(false);
    setFreeTier(null);
    prevBillingRef.current = null;

    if (!namespaceReady) {
      return;
    }

    fetchAssistantSession(namespaceRaw, kubeconfig, desktopUserId).then(
      (payload) => {
        if (cancelled) {
          return;
        }
        if (payload == null) {
          setSessionError(true);
          return;
        }
        setSession(payload);
        setFreeTier(payload.freeTier);
        prevBillingRef.current = payload.freeTier.billing;
      }
    );

    return () => {
      cancelled = true;
    };
  }, [desktopUserId, kubeconfig, namespaceRaw, namespaceReady]);

  const handleBillingHeaders = useCallback((headers: Headers) => {
    const billingHeader = headers.get("X-Chat-Billing");
    if (billingHeader !== "free" && billingHeader !== "user") {
      return;
    }
    const remaining = Number.parseInt(
      headers.get("X-Chat-Free-Remaining") ?? "",
      10
    );
    const limit = Number.parseInt(headers.get("X-Chat-Free-Limit") ?? "", 10);
    setFreeTier((prev) => {
      if (Number.isFinite(remaining) && Number.isFinite(limit)) {
        return { billing: billingHeader, remaining, limit };
      }
      return prev == null
        ? { billing: billingHeader, remaining: 0, limit: 0 }
        : { ...prev, billing: billingHeader };
    });
    if (prevBillingRef.current === "free" && billingHeader === "user") {
      toast.info("Free assistant allowance used up", {
        description: "Further messages now use your own AI Proxy balance.",
      });
    }
    prevBillingRef.current = billingHeader;
  }, []);

  const selectThread = useCallback(
    async (threadId: string) => {
      if (threadId === session?.chatId) {
        return;
      }
      const messages = await fetchAssistantThreadMessages(
        threadId,
        namespaceRaw,
        kubeconfig
      );
      if (messages == null) {
        return;
      }
      setSession((prev) =>
        prev == null ? prev : { ...prev, chatId: threadId, messages }
      );
    },
    [kubeconfig, namespaceRaw, session?.chatId]
  );

  const createThread = useCallback(async () => {
    setCreatingThread(true);
    try {
      const created = await createAssistantThread(
        namespaceRaw,
        kubeconfig,
        desktopUserId
      );
      if (created == null) {
        return;
      }
      setSession((prev) =>
        prev == null
          ? prev
          : {
              chatId: created.chatId,
              messages: [],
              threads: created.threads,
              freeTier: prev.freeTier,
            }
      );
    } finally {
      setCreatingThread(false);
    }
  }, [desktopUserId, kubeconfig, namespaceRaw]);

  const refreshThreads = useCallback(async () => {
    const threads = await fetchAssistantThreads(
      namespaceRaw,
      kubeconfig,
      desktopUserId
    );
    if (threads == null || threads.length === 0) {
      return;
    }
    setSession((prev) => (prev == null ? prev : { ...prev, threads }));
  }, [desktopUserId, kubeconfig, namespaceRaw]);

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
      freeTier={freeTier}
      key={session.chatId}
      onAssistantStreamFinished={refreshThreads}
      onBillingHeaders={handleBillingHeaders}
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

const ProjectAssistantChatPaneMemo = memo(ProjectAssistantChatPane);

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
  const projectName = currentProject.displayName ?? "Project";
  const projectDescription = currentProject.description ?? "";
  const [editOpen, setEditOpen] = useState(false);
  const { mutate } = useSWRConfig();
  const revalidateProjects = useCallback(
    () =>
      mutate(
        (key) => Array.isArray(key) && key[0] === "/api/projects",
        undefined,
        { revalidate: true }
      ),
    [mutate]
  );
  const submitProjectEdit = useCallback(
    async (next: ProjectEditDialogValues) => {
      const encodedKubeconfig = kubeconfig.trim();
      if (encodedKubeconfig === "") {
        throw new Error("Credentials are not ready yet.");
      }

      try {
        const result = await fetcher<BrainProjectResponse>({
          base: window.location.origin,
          path: "/api/projects",
          method: "PATCH",
          header: { Authorization: kubeconfigBearerHeader(encodedKubeconfig) },
          body: {
            description: next.description,
            displayName: next.displayName,
            id: projectId,
            namespace,
          },
        });
        await revalidateProjects();
        toast.success(`Updated "${result.project.displayName}".`);
      } catch (error) {
        const message = errorDescription(error, "Project update failed.");
        toastErrorDetail("Project update failed.", message);
        throw new Error(message);
      }
    },
    [kubeconfig, namespace, projectId, revalidateProjects]
  );

  return (
    <>
      <header
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex h-13 items-center gap-2 bg-[#09090B]/10 pr-2 pl-6 backdrop-blur-lg",
          !assistantPaneOpen && "pr-12"
        )}
      >
        <div className="pointer-events-auto flex min-w-0 shrink-0 basis-40 items-center gap-1">
          {showProjectName && currentProject.isLoading ? (
            <Skeleton className="h-5 w-36 max-w-full" />
          ) : null}
          {showProjectName && !currentProject.isLoading ? (
            <>
              <button
                aria-label={`Edit project name: ${projectName}`}
                className="flex min-w-0 shrink-0 cursor-pointer items-center gap-[6px] overflow-hidden rounded-md p-2 text-left transition-colors hover:bg-input/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                onClick={() => setEditOpen(true)}
                type="button"
              >
                <h1 className="truncate font-medium text-foreground text-sm leading-5">
                  {projectName}
                </h1>
                <SquarePen
                  aria-hidden
                  className="size-3.5 shrink-0 text-foreground"
                  strokeWidth={2}
                />
              </button>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
            </>
          ) : null}
        </div>
      </header>
      <ProjectEditDialog
        currentDescription={projectDescription}
        currentName={projectName}
        dataSlot="project-route-edit-dialog"
        idBase="project-route-edit"
        onOpenChange={setEditOpen}
        onSubmit={submitProjectEdit}
        open={editOpen}
      />
    </>
  );
}

const ProjectRouteTopBarMemo = memo(ProjectRouteTopBar);

/** Main project column + optional Project Assistant Pane (`POST /api/chat` + AI SDK). */
function ProjectWorkspaceLayoutContent({ children }: { children: ReactNode }) {
  const assistantPaneOpen = useAtomValue(assistantPaneOpenAtom);
  const setAssistantPaneOpen = useSetAtom(assistantPaneOpenAtom);
  const toggleAssistantPane = useCallback(() => {
    setAssistantPaneOpen((open) => !open);
  }, [setAssistantPaneOpen]);
  const [paneWidth, setPaneWidth] = useAtom(assistantPaneWidthAtom);
  const [paneResizing, setPaneResizing] = useAtom(assistantPaneResizingAtom);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [viewportResizing, setViewportResizing] = useState(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const workspaceWidthRef = useRef(workspaceWidth);
  const viewportResizingRef = useRef(false);
  const viewportResizeTimerRef = useRef<number | null>(null);
  const paneWidthRef = useRef(paneWidth);
  paneWidthRef.current = paneWidth;
  const dragRef = useRef<{
    lastWidth: number;
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);

  useEffect(() => {
    const stored = readStoredAssistantPaneWidth();
    if (stored != null) {
      setPaneWidth(stored);
    }
  }, [setPaneWidth]);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (workspace == null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width == null) {
        return;
      }
      const roundedWidth = Math.round(width);
      if (workspaceWidthRef.current === roundedWidth) {
        return;
      }
      workspaceWidthRef.current = roundedWidth;
      setWorkspaceWidth(roundedWidth);
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    let lastWidth = window.innerWidth;
    let lastHeight = window.innerHeight;

    const clearViewportResizeTimer = () => {
      if (viewportResizeTimerRef.current == null) {
        return;
      }
      window.clearTimeout(viewportResizeTimerRef.current);
      viewportResizeTimerRef.current = null;
    };

    const settleViewportResize = () => {
      viewportResizeTimerRef.current = null;
      if (!viewportResizingRef.current) {
        return;
      }
      viewportResizingRef.current = false;
      setViewportResizing(false);
    };

    const handleViewportResize = () => {
      const nextWidth = window.innerWidth;
      const nextHeight = window.innerHeight;
      if (nextWidth === lastWidth && nextHeight === lastHeight) {
        return;
      }
      lastWidth = nextWidth;
      lastHeight = nextHeight;
      if (!viewportResizingRef.current) {
        viewportResizingRef.current = true;
        setViewportResizing(true);
      }
      clearViewportResizeTimer();
      viewportResizeTimerRef.current = window.setTimeout(
        settleViewportResize,
        VIEWPORT_RESIZE_SETTLE_MS
      );
    };

    window.addEventListener("resize", handleViewportResize);
    visualViewport?.addEventListener("resize", handleViewportResize);

    return () => {
      clearViewportResizeTimer();
      window.removeEventListener("resize", handleViewportResize);
      visualViewport?.removeEventListener("resize", handleViewportResize);
    };
  }, []);

  const cancelPaneResize = useCallback(() => {
    if (dragRef.current == null) {
      return;
    }
    dragRef.current = null;
    setPaneResizing(false);
  }, [setPaneResizing]);

  // The divider unmounts without a pointerup when the pane closes mid-drag.
  useEffect(() => {
    if (!assistantPaneOpen) {
      cancelPaneResize();
    }
  }, [assistantPaneOpen, cancelPaneResize]);

  useEffect(() => {
    return cancelPaneResize;
  }, [cancelPaneResize]);

  const endPaneResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag == null || drag.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setPaneResizing(false);
      writeStoredAssistantPaneWidth(drag.lastWidth);
    },
    [setPaneResizing]
  );

  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const workspace = workspaceRef.current;
      if (event.button !== 0 || workspace == null) {
        return;
      }
      const startWidth = clampAssistantPaneWidth(
        paneWidthRef.current,
        workspace.getBoundingClientRect().width
      );
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        lastWidth: startWidth,
        pointerId: event.pointerId,
        startWidth,
        startX: event.clientX,
      };
      setPaneResizing(true);
    },
    [setPaneResizing]
  );

  const handleResizePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const workspace = workspaceRef.current;
      if (
        drag == null ||
        drag.pointerId !== event.pointerId ||
        workspace == null
      ) {
        return;
      }
      const next = clampAssistantPaneWidth(
        drag.startWidth + (drag.startX - event.clientX),
        workspace.getBoundingClientRect().width
      );
      drag.lastWidth = next;
      setPaneWidth(next);
    },
    [setPaneWidth]
  );

  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      const workspace = workspaceRef.current;
      if (workspace == null) {
        return;
      }
      event.preventDefault();
      const available = workspace.getBoundingClientRect().width;
      const step =
        event.key === "ArrowLeft"
          ? ASSISTANT_PANE_RESIZE_STEP
          : -ASSISTANT_PANE_RESIZE_STEP;
      const next = clampAssistantPaneWidth(
        clampAssistantPaneWidth(paneWidthRef.current, available) + step,
        available
      );
      setPaneWidth(next);
      writeStoredAssistantPaneWidth(next);
    },
    [setPaneWidth]
  );

  const handleResizeDoubleClick = useCallback(() => {
    setPaneWidth(ASSISTANT_PANE_DEFAULT_WIDTH);
    writeStoredAssistantPaneWidth(null);
  }, [setPaneWidth]);

  // Rendered as plain px: transitioning between clamp() values wedges the CSS
  // width transition in Chrome, so the workspace clamp is resolved here.
  const renderedPaneWidth = clampAssistantPaneWidth(paneWidth, workspaceWidth);

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden",
        paneResizing && "cursor-col-resize select-none"
      )}
      data-viewport-resizing={viewportResizing || undefined}
      ref={workspaceRef}
    >
      <section
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-slot="project-main-pane"
      >
        <ProjectRouteTopBarMemo assistantPaneOpen={assistantPaneOpen} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </section>
      {assistantPaneOpen ? (
        <div
          className="relative z-30 w-0 shrink-0"
          data-slot="assistant-pane-resizer"
        >
          {/* biome-ignore lint/a11y/useSemanticElements: WAI-ARIA window-splitter pattern needs a focusable `role="separator"` widget; `<hr>` is a static, void separator. */}
          <div
            aria-label="Resize assistant pane"
            aria-orientation="vertical"
            aria-valuemax={assistantPaneMaxWidth(workspaceWidth)}
            aria-valuemin={ASSISTANT_PANE_MIN_WIDTH}
            aria-valuenow={renderedPaneWidth}
            className="group/pane-resize absolute inset-y-0 -left-1 w-2 cursor-col-resize outline-none"
            onDoubleClick={handleResizeDoubleClick}
            onKeyDown={handleResizeKeyDown}
            onLostPointerCapture={endPaneResize}
            onPointerCancel={endPaneResize}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={endPaneResize}
            role="separator"
            tabIndex={0}
          >
            <div
              className={cn(
                "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-ring opacity-0 transition-opacity duration-150 group-hover/pane-resize:opacity-60 group-focus-visible/pane-resize:opacity-100",
                paneResizing && "opacity-100"
              )}
            />
          </div>
        </div>
      ) : null}
      <aside
        aria-hidden={!assistantPaneOpen}
        className={cn(
          "project-chrome-surface project-surface-slide-x box-border flex min-h-0 shrink-0 flex-col overflow-hidden border-l transition-[width,opacity,transform,border-color] ease-[var(--project-surface-motion-ease)] motion-reduce:transform-none motion-reduce:transition-none",
          assistantPaneOpen
            ? "project-surface-slide-x-open border-border opacity-100 duration-[var(--project-surface-motion-enter-duration)]"
            : "project-surface-slide-x-offset pointer-events-none border-transparent opacity-0 duration-[var(--project-surface-motion-exit-duration)]",
          (paneResizing || viewportResizing) && "transition-none"
        )}
        data-slot="project-assistant-pane"
        id="project-assistant-pane"
        style={{ width: assistantPaneOpen ? renderedPaneWidth : 0 }}
      >
        <ProjectAssistantChatPaneMemo />
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
