"use client";

import { Chat } from "@workspace/ui/components/chat/chat";
import { GithubDeployer } from "@workspace/ui/components/github-deployer/github-deployer";
import type { GithubDeployerRepo } from "@workspace/ui/components/github-deployer/github-deployer.types";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import {
  buildGithubDeployerDeployedAguiExecuteInput,
  githubDeployerDeployedAguiSpec,
} from "@workspace/ui/lib/agui/github-deployer-spec";
import type { UIMessage } from "ai";
import { useCallback, useState } from "react";

import {
  chatPreviewDemoRepos,
  chatPreviewMessageSeed,
  chatPreviewStubAssistantReply,
  chatPreviewThreadAId,
  chatPreviewThreadBId,
} from "./chat-preview.data";

/** Inline deployer with local dummy state for the transcript footer. */
function TranscriptGithubDeployerDemo({
  onCommitDeploy,
}: {
  onCommitDeploy: (repo: GithubDeployerRepo) => void;
}) {
  const [gh, setGh] = useState({
    deployedRepo: null as GithubDeployerRepo | null,
    isAuthorized: false,
    isLoading: false,
    repos: [...chatPreviewDemoRepos],
  });

  return (
    <div className="rounded-xl border border-border bg-background p-3 shadow-sm">
      <GithubDeployer.Root
        actions={{
          onAuthorize: () =>
            setGh((p) => ({
              ...p,
              isAuthorized: true,
              isLoading: false,
            })),
          onDeploy: (repo) => {
            onCommitDeploy(repo);
          },
        }}
        states={gh}
      >
        <GithubDeployer.Shell />
      </GithubDeployer.Root>
    </div>
  );
}

function ChatWorkspacePreview({
  onGithubButton,
}: {
  onGithubButton?: () => void;
}) {
  const [threadId, setThreadId] = useState(chatPreviewThreadAId);
  const [rowsByThread, setRowsByThread] = useState(chatPreviewMessageSeed);
  const [input, setInput] = useState("");
  const [transcriptDeployerOpen, setTranscriptDeployerOpen] = useState(false);

  const selectThread = useCallback((id: string) => {
    setTranscriptDeployerOpen(false);
    setThreadId(id);
  }, []);

  const goNewThread = useCallback(() => {
    setTranscriptDeployerOpen(false);
    setThreadId(chatPreviewThreadAId);
  }, []);

  const rows = rowsByThread[threadId] ?? [];
  const title = threadId === chatPreviewThreadAId ? "Onboarding" : "Quick ask";

  const handleCommitDeploy = useCallback(
    (repo: GithubDeployerRepo) => {
      const spec = githubDeployerDeployedAguiSpec(repo);
      const executeInput = buildGithubDeployerDeployedAguiExecuteInput(repo);
      const toolPart = {
        type: "tool-emitGenUISpec" as const,
        toolCallId: `preview-deploy-${Date.now()}`,
        state: "output-available" as const,
        input: executeInput,
        output: { ok: true as const, spec },
      } satisfies UIMessage["parts"][number];
      setRowsByThread((p) => ({
        ...p,
        [threadId]: [
          ...(p[threadId] ?? []),
          {
            id: `a-deploy-${Date.now()}`,
            role: "assistant" as const,
            parts: [toolPart],
          },
        ],
      }));
      setTranscriptDeployerOpen(false);
    },
    [threadId]
  );

  const transcriptFooter = transcriptDeployerOpen ? (
    <TranscriptGithubDeployerDemo onCommitDeploy={handleCommitDeploy} />
  ) : null;

  const githubAction =
    onGithubButton ?? (() => setTranscriptDeployerOpen((o) => !o));

  const onPrimaryAction = useCallback(() => {
    const text = input.trim();
    if (!text) {
      return;
    }
    const u: UIMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text }],
    };
    setRowsByThread((p) => ({
      ...p,
      [threadId]: [...(p[threadId] ?? []), u],
    }));
    setInput("");
    window.setTimeout(() => {
      setRowsByThread((p) => ({
        ...p,
        [threadId]: [
          ...(p[threadId] ?? []),
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            parts: [
              {
                type: "text",
                text: chatPreviewStubAssistantReply,
              },
            ],
          },
        ],
      }));
    });
  }, [input, threadId]);

  return (
    <div className="flex h-[min(72rem,70vh)] w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <Chat.Root>
        <Chat className="h-full min-h-0 flex-1 border-0 shadow-none">
          <Chat.Header
            className="shrink-0"
            threadHistory={{
              activeThreadId: threadId,
              items: [
                {
                  id: chatPreviewThreadAId,
                  title: "Onboarding",
                  updatedAt: "2h",
                },
                {
                  id: chatPreviewThreadBId,
                  title: "Quick ask",
                  updatedAt: "Yesterday",
                },
              ],
              onSelect: selectThread,
            }}
            threadName={title}
          >
            <Chat.NewThread onNewThread={goNewThread} />
          </Chat.Header>
          <Chat.Transcript
            className="min-h-0 flex-1"
            messages={rows}
            status={undefined}
            transcriptFooter={transcriptFooter}
          />
          <Chat.ComposerFocusScope className="relative flex shrink-0 flex-col items-center p-2">
            <Chat.ContextIndicator
              className="z-10"
              contextToggles={[title, "Sample preview context"]}
            />
            <Chat.ComposerShell className="z-20">
              <Chat.ComposerTextarea
                onPrimaryAction={onPrimaryAction}
                onValueChange={setInput}
                placeholder="Message…"
                responding={false}
                value={input}
              />

              <Chat.ComposerFooter>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <Chat.GithubDeployButton onComposerAction={githubAction} />
                </div>
                <Chat.ComposerSend
                  onPrimaryAction={onPrimaryAction}
                  responding={false}
                  value={input}
                />
              </Chat.ComposerFooter>
            </Chat.ComposerShell>
          </Chat.ComposerFocusScope>
        </Chat>
      </Chat.Root>
    </div>
  );
}

export interface ChatPreviewProps {
  /** GitHub icon in the composer; omitted → toggles inline deployer in the transcript (dummy data). */
  onGithubButton?: () => void;
}

export default function ChatPreview({ onGithubButton }: ChatPreviewProps = {}) {
  return (
    <PreviewWrapper>
      <Preview showReset title="Project pane — thread dropdown + toolbar">
        <ChatWorkspacePreview onGithubButton={onGithubButton} />
      </Preview>
    </PreviewWrapper>
  );
}
