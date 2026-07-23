"use client";

import { useChat as useAIChat } from "@ai-sdk/react";
import { fetcher } from "@workspace/api/fetch";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import {
  DefaultChatTransport,
  generateId,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  SquarePen,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  type TransitionEvent,
  useCallback,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Chat } from "@/features/chat/chat";
import type { ChatHeaderThreadHistory } from "@/features/chat/chat.types";
import { FreeTurnsIndicator } from "@/features/chat/free-turns-indicator";
import {
  fetchAssistantSession,
  fetchAssistantThreadMessages,
  fetchAssistantThreads,
} from "@/features/chat/persistence/client";
import {
  type AssistantContextPayload,
  type AssistantSessionPayload,
  type AssistantThreadDTO,
  type FreeTierState,
  SELECTED_RESOURCE_CONTEXT_PART_TYPE,
  type SelectedResourceContext,
} from "@/features/chat/persistence/types";
import {
  NAVIGATE_APP_TOOL_NAME,
  type NavigateAppToolOutput,
  runNavigateAppTool,
} from "@/features/chat/tool/chat-navigate-app-tool";
import {
  OPEN_PROJECT_SURFACE_TOOL_NAME,
  type OpenProjectSurfaceToolOutput,
  runOpenProjectSurfaceTool,
} from "@/features/chat/tool/chat-open-project-surface-tool";
import {
  REFRESH_FRONTEND_SWR_TOOL_NAME,
  type RefreshFrontendSwrCachesToolOutput,
  runRefreshFrontendSwrCachesTool,
} from "@/features/chat/tool/chat-refresh-frontend-swr-tool";
import { useGithubAuth } from "@/features/deploy/github/use-github-auth";
import { dispatchDeployTaskCreatedEvent } from "@/features/deploy/task/browser-events";
import { scanMessagesForDeployTaskCreations } from "@/features/deploy/task/chat-bridge-scan";
import { useCurrentProjectDisplayName } from "@/features/deploy/use-current-project-display-name";
import {
  ASSISTANT_PANE_DEFAULT_WIDTH,
  ASSISTANT_PANE_MIN_WIDTH,
  ASSISTANT_PANE_RESIZE_STEP,
  assistantPaneMaxWidth,
  clampAssistantPaneWidth,
  readStoredAssistantPaneWidth,
  writeStoredAssistantPaneWidth,
} from "@/features/panes/assistant-pane-width";
import {
  type ProjectCanvasSelection,
  projectCanvasSelectionTarget,
} from "@/features/panes/canvas-selection";
import {
  assistantDraftThreadRequestAtom,
  assistantPaneOpenAtom,
  assistantPaneResizingAtom,
  assistantPaneWidthAtom,
} from "@/features/panes/layout-store";
import {
  ProjectSidePaneProvider,
  useProjectSidePaneAssistantRouter,
} from "@/features/panes/react";
import {
  ProjectIdProvider,
  useProjectId,
} from "@/features/panes/use-project-id";
import {
  PROJECT_SELECTED_QUERY_KEY,
  parseProjectCanvasSelection,
} from "@/features/panes/workbench-url-codec";
import type { BrainProjectResponse } from "@/features/projects/brain-projects";
import {
  ProjectEditDialog,
  type ProjectEditDialogValues,
} from "@/features/projects/project-edit-dialog";
import { isAssistantChatNamespaceReady } from "@/features/shell/project-assistant-chat-readiness";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import { errorDescription, toastErrorDetail } from "@/lib/toast-utils";
import { useEnterMotionFrames } from "@/lib/use-enter-motion-frames";

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

// The transport is memoized so it stays stable across URL changes; its send-time
// closures must still see the latest thread-stable wire fields and billing
// handler. They read them from this external store (keyed per session by a
// stable token) rather than closing over a React ref, since ref reads inside the
// `new DefaultChatTransport(...)` closures would run afoul of render-time rules.
const transportLatestStore = new WeakMap<
  object,
  {
    namespace: string;
    onBillingHeaders: (headers: Headers) => void;
    projectId: string;
  }
>();

const VIEWPORT_RESIZE_SETTLE_MS = 180;
// --project-surface-motion-enter-duration (340ms) plus scheduling slack;
// `transitionend` normally settles the pane first, this is the fallback.
const ASSISTANT_PANE_ENTER_SETTLE_MS = 420;

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

/**
 * The one part of the composer that depends on the canvas selection: the
 * "Current Project" / "Current Service" context chips. Isolating the `selected`
 * subscription here means selecting or clearing a canvas node re-renders only
 * this chip — not the composer's textarea or the deploy buttons below it.
 *
 * It also mirrors the live selection into `selectedRef` so the composer can pin
 * the selection snapshot at send time (ADR 0044) without subscribing to it.
 */
function ComposerContextIndicator({
  projectId,
  selectedRef,
}: {
  projectId: string;
  selectedRef: { current: ProjectCanvasSelection | null };
}) {
  const [selectedQuery] = useQueryState(
    PROJECT_SELECTED_QUERY_KEY,
    parseAsString
  );
  const selected = useMemo(
    () => parseProjectCanvasSelection(selectedQuery),
    [selectedQuery]
  );
  // The composer reads `selectedRef.current` at submit time; keep it current
  // without forcing the composer to re-render on every select/deselect.
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected, selectedRef]);

  const contextToggles = useMemo(() => {
    const toggles: string[] = [];
    if (projectId.trim() !== "") {
      toggles.push("Current Project");
    }
    if (selected != null && selected.kind !== "edge") {
      toggles.push("Current Service");
    }
    return toggles;
  }, [projectId, selected]);

  if (contextToggles.length === 0) {
    return null;
  }

  return (
    <div className="relative h-0 w-full overflow-visible transition-[height] duration-300 ease-out group-focus-within:h-6 motion-reduce:transition-none">
      <div className="pointer-events-none absolute inset-x-0 top-full w-full -translate-y-full">
        <Chat.ContextIndicator
          className="w-full"
          contextToggles={contextToggles}
        />
      </div>
    </div>
  );
}

function ProjectAssistantComposer({
  busy,
  projectId,
  onDatabaseIntent,
  onDockerIntent,
  onGithubIntent,
  onSkillsIntent,
  onStop,
  onSubmit,
}: {
  busy: boolean;
  projectId: string;
  onDatabaseIntent: () => void;
  onDockerIntent: () => void;
  onGithubIntent: () => void;
  onSkillsIntent: () => void;
  onStop: () => void;
  onSubmit: (text: string, selected: ProjectCanvasSelection | null) => void;
}) {
  const [input, setInput] = useState("");
  const { isAuthorized, isLoading: authLoading } = useGithubAuth();
  // The volatile canvas selection lives in `ComposerContextIndicator` below, so
  // select/deselect re-renders stop at that tiny chip instead of sweeping the
  // composer body (textarea + deploy buttons). The indicator keeps this ref in
  // sync; submit reads it to pin the selection snapshot (ADR 0044) without
  // subscribing the composer itself to the selection.
  const selectedRef = useRef<ProjectCanvasSelection | null>(null);

  const onPrimaryAction = useCallback(() => {
    if (busy) {
      onStop();
      return;
    }
    const text = input.trim();
    if (!text) {
      return;
    }
    onSubmit(text, selectedRef.current);
    setInput("");
  }, [busy, input, onStop, onSubmit]);

  return (
    <div className="group flex w-full shrink-0 flex-col p-[10px]">
      <ComposerContextIndicator
        projectId={projectId}
        selectedRef={selectedRef}
      />
      <Chat.ComposerShell>
        <Chat.ComposerTextarea
          onPrimaryAction={onPrimaryAction}
          onValueChange={setInput}
          placeholder="Ask Sealos Agent to inspect, deploy, or explain this project..."
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
  threads: AssistantThreadDTO[];
  assistantNamespaceRaw: string;
  onAssistantStreamFinished?: () => Promise<void>;
  onBillingHeaders: (headers: Headers) => void;
  onDatabaseIntent: () => void;
  onDockerIntent: () => void;
  onCreateThread: () => void;
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
  // Incremental-scan cursor for the deploy-task bridge below; keyed by project
  // so a project switch rescans the transcript from the start.
  const deployTaskScanCursorRef = useRef<{
    projectId: string;
    scannedParts: ReadonlyMap<string, number>;
  }>({ projectId: "", scannedParts: new Map() });

  const projectId = useProjectId();
  const currentProject = useCurrentProjectDisplayName({
    kubeconfig,
    namespace,
    projectId,
  });
  // Publish the live wire fields + billing handler to the external store so the
  // transport memo stays stable across URL changes while its send-time closures
  // still read the latest values. The volatile canvas selection is pinned
  // per-message (see submitComposerText), so only thread-stable fields go here.
  const [transportToken] = useState<object>(() => ({}));
  useInsertionEffect(() => {
    transportLatestStore.set(transportToken, {
      namespace: assistantNamespaceRaw,
      onBillingHeaders,
      projectId,
    });
  });

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // Wrapper only forwards calls, so fetch statics (preconnect) stay on
        // the real fetch; the cast satisfies the transport's `typeof fetch`.
        fetch: (async (input, init) => {
          const response = await fetch(input, init);
          transportLatestStore
            .get(transportToken)
            ?.onBillingHeaders(response.headers);
          return response;
        }) as typeof fetch,
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
          const latest = transportLatestStore.get(transportToken);
          const wire = {
            namespace: latest?.namespace ?? "",
            projectId: latest?.projectId ?? "",
          };
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
    [currentProject.displayName, kubeconfig, transportToken]
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
    // Cap streaming re-renders at ~20/s; without this every SSE chunk
    // re-renders the whole chat session (AI SDK docs' recommended mitigation).
    experimental_throttle: 50,
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

  useInsertionEffect(() => {
    addToolOutputRef.current = addToolOutput;
  });

  useEffect(() => {
    const currentProjectId = projectId.trim();
    if (currentProjectId === "") {
      return;
    }
    if (deployTaskScanCursorRef.current.projectId !== currentProjectId) {
      deployTaskScanCursorRef.current = {
        projectId: currentProjectId,
        scannedParts: new Map(),
      };
    }
    const scan = scanMessagesForDeployTaskCreations({
      messages,
      projectId: currentProjectId,
      scannedParts: deployTaskScanCursorRef.current.scannedParts,
      seenTaskIds: bridgedToolDeployTaskIdsRef.current,
    });
    deployTaskScanCursorRef.current = {
      projectId: currentProjectId,
      scannedParts: scan.scannedParts,
    };
    for (const detail of scan.details) {
      bridgedToolDeployTaskIdsRef.current.add(detail.taskId);
      dispatchDeployTaskCreatedEvent(detail);
    }
  }, [messages, projectId]);
  const createThreadClicked = useCallback(() => {
    onCreateThread();
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
    // No row yet = unsaved draft thread (or a just-materialized one awaiting
    // the list refresh); label it like the fresh conversation it is.
    return hit?.title ?? "New chat";
  }, [threads, chatId]);

  const busy = status === "submitted" || status === "streaming";

  const submitComposerText = useCallback(
    (text: string, selected: ProjectCanvasSelection | null) => {
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
    [sendMessage]
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
          onDatabaseIntent={onDatabaseIntent}
          onDockerIntent={onDockerIntent}
          onGithubIntent={onGithubIntent}
          onSkillsIntent={onSkillsIntent}
          onStop={stopComposerResponse}
          onSubmit={submitComposerText}
          projectId={projectId}
        />
      </Chat>
    </Chat.Root>
  );
}

function ProjectAssistantChatPane() {
  const namespaceRaw = useAtomValue(namespaceAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespaceReady = isAssistantChatNamespaceReady(namespaceRaw);
  const sidePaneRouter = useProjectSidePaneAssistantRouter();
  const [session, setSession] = useState<AssistantSessionPayload | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const [freeTier, setFreeTier] = useState<FreeTierState | null>(null);
  const prevBillingRef = useRef<"free" | "user" | null>(null);

  const sessionResetKey = `${kubeconfig} ${namespaceRaw} ${namespaceReady}`;
  const [prevSessionResetKey, setPrevSessionResetKey] =
    useState(sessionResetKey);
  if (prevSessionResetKey !== sessionResetKey) {
    setPrevSessionResetKey(sessionResetKey);
    setSession(null);
    setSessionError(false);
    setFreeTier(null);
  }

  useEffect(() => {
    let cancelled = false;
    prevBillingRef.current = null;

    if (!namespaceReady) {
      return;
    }

    fetchAssistantSession(namespaceRaw, kubeconfig).then((payload) => {
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
    });

    return () => {
      cancelled = true;
    };
  }, [kubeconfig, namespaceRaw, namespaceReady]);

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

  // The verified actor is bound when the first message materializes this draft.
  // Abandoned drafts therefore never leave empty persisted conversations.
  const startDraftThread = useCallback(() => {
    setSession((prev) =>
      prev == null ? prev : { ...prev, chatId: generateId(), messages: [] }
    );
  }, []);

  // Project creation (pane flow) asks for a clean owned conversation.
  const draftRequest = useAtomValue(assistantDraftThreadRequestAtom);
  const draftRequestSeenRef = useRef(draftRequest);
  useEffect(() => {
    if (draftRequestSeenRef.current === draftRequest) {
      return;
    }
    draftRequestSeenRef.current = draftRequest;
    startDraftThread();
  }, [draftRequest, startDraftThread]);

  const refreshThreads = useCallback(async () => {
    const threads = await fetchAssistantThreads(namespaceRaw, kubeconfig);
    if (threads == null || threads.length === 0) {
      return;
    }
    setSession((prev) => (prev == null ? prev : { ...prev, threads }));
  }, [kubeconfig, namespaceRaw]);

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
      freeTier={freeTier}
      key={session.chatId}
      onAssistantStreamFinished={refreshThreads}
      onBillingHeaders={handleBillingHeaders}
      onCreateThread={startDraftThread}
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
  const projectId = useProjectId();
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
      {/* The bar itself stays filter-free: frost is clipped to the content
          chip so canvas pan/zoom frames never re-filter a full-width strip. */}
      <header
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex h-13 items-center gap-2 pr-2 pl-6",
          !assistantPaneOpen && "pr-12"
        )}
      >
        <div className="pointer-events-auto flex min-w-0 shrink-0 basis-40 items-center">
          {showProjectName ? (
            <div className="flex min-w-0 items-center gap-1 rounded-lg bg-background/10 backdrop-blur-lg">
              {currentProject.isLoading ? (
                <Skeleton className="h-5 w-36 max-w-full" />
              ) : (
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
              )}
            </div>
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
  // Open/close animates the pane as a transform+opacity overlay; layout width
  // is reserved in one snap once the enter transition settles (and released at
  // close start), so the canvas reflows once per toggle instead of per frame.
  // Mounting with the pane already open reserves immediately — there is no
  // enter transition to wait for.
  const [paneEnterSettled, setPaneEnterSettled] = useState(assistantPaneOpen);
  // The enter beat paints the closed (offscreen) pose before motion starts —
  // without it the shared ease-out is caught mid-flight and reads as a fade.
  const paneMotionOpen = useEnterMotionFrames(assistantPaneOpen);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const workspaceWidthRef = useRef(workspaceWidth);
  const viewportResizingRef = useRef(false);
  const viewportResizeTimerRef = useRef<number | null>(null);
  const paneWidthRef = useRef(paneWidth);
  useInsertionEffect(() => {
    paneWidthRef.current = paneWidth;
  });
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

  useEffect(() => {
    let cancelled = false;
    if (!assistantPaneOpen) {
      queueMicrotask(() => {
        if (!cancelled) {
          setPaneEnterSettled(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      queueMicrotask(() => {
        if (!cancelled) {
          setPaneEnterSettled(true);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    const timeout = window.setTimeout(() => {
      setPaneEnterSettled(true);
    }, ASSISTANT_PANE_ENTER_SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [assistantPaneOpen]);

  const handlePaneTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      if (
        event.propertyName !== "transform" &&
        event.propertyName !== "opacity"
      ) {
        return;
      }
      if (assistantPaneOpen) {
        setPaneEnterSettled(true);
      }
    },
    [assistantPaneOpen]
  );

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

  // Resolved to plain px in JS so the overlay pane and the layout reserve
  // below always agree on the same value (drag and viewport resizes keep
  // tracking it live; only open/close snaps).
  const renderedPaneWidth = clampAssistantPaneWidth(paneWidth, workspaceWidth);
  const paneReservedWidth =
    assistantPaneOpen && paneEnterSettled ? renderedPaneWidth : 0;

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
      {assistantPaneOpen && paneEnterSettled ? (
        <div
          className="relative z-40 w-0 shrink-0"
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
      {/* Layout reserve for the overlay pane: never transitions — it snaps
          once the enter transition settles and releases at close start, so
          the reflow always happens underneath the opaque pane. */}
      <div
        aria-hidden
        className="shrink-0"
        data-slot="assistant-pane-reserve"
        style={{ width: paneReservedWidth }}
      />
      {/* Same two-layer recipe as side-pane.tsx: the outer clip box nudges
          and fades while the inner chrome surface slides its full width, so
          the panel emerges from the right edge instead of fading in place. */}
      <aside
        aria-hidden={!paneMotionOpen}
        className={cn(
          "project-surface-slide-x absolute inset-y-0 right-0 z-30 overflow-hidden transition-[opacity,transform] ease-[var(--project-surface-motion-ease)] motion-reduce:transform-none motion-reduce:transition-none",
          paneMotionOpen
            ? "project-surface-slide-x-open opacity-100 duration-[var(--project-surface-motion-enter-duration)]"
            : "project-surface-slide-x-offset pointer-events-none opacity-0 duration-[var(--project-surface-motion-exit-duration)]",
          (paneResizing || viewportResizing) && "transition-none"
        )}
        data-slot="project-assistant-pane"
        id="project-assistant-pane"
        onTransitionEnd={handlePaneTransitionEnd}
        style={{ width: renderedPaneWidth }}
      >
        <div
          className={cn(
            "project-chrome-surface project-surface-slide-x absolute inset-y-0 right-0 box-border flex min-h-0 w-full flex-col overflow-hidden border-border border-l shadow-lg transition-transform ease-[var(--project-surface-motion-ease)] motion-reduce:transform-none motion-reduce:transition-none",
            paneMotionOpen
              ? "project-surface-slide-x-open duration-[var(--project-surface-motion-enter-duration)]"
              : "project-surface-slide-x-full duration-[var(--project-surface-motion-exit-duration)]",
            (paneResizing || viewportResizing) && "transition-none"
          )}
        >
          <ProjectAssistantChatPaneMemo />
        </div>
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
      <ProjectIdProvider>
        <ProjectWorkspaceLayoutContent>
          {children}
        </ProjectWorkspaceLayoutContent>
      </ProjectIdProvider>
    </ProjectSidePaneProvider>
  );
}
