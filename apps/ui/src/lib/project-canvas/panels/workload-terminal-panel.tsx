"use client";

import { Button } from "@workspace/ui/components/button";
import type { ContainerNodeStates } from "@workspace/ui/components/container-node/container-node";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { Circle, SquareTerminal, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { containerStatesFromNode } from "@/lib/project-canvas/flow/container-node-workload";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import { workloadTerminalWebSocketUrl } from "./workload-terminal-url";

type TerminalStatus = "connecting" | "closed" | "error" | "ready";

interface TerminalLine {
  id: number;
  tone?: "error" | "muted" | "success";
  value: string;
}

interface TerminalServerMessage {
  container?: string;
  message?: string;
  namespace?: string;
  pod?: string;
  type: "close" | "error" | "output" | "ready";
  value?: string;
}

function terminalTitle(states: ContainerNodeStates | null): string {
  return states?.name?.trim() || "Terminal";
}

function terminalSubtitle({
  container,
  pod,
  states,
  status,
}: {
  container: string;
  pod: string;
  states: ContainerNodeStates | null;
  status: TerminalStatus;
}) {
  const image = states?.image?.trim();
  const target = pod && container ? `${pod} / ${container}` : "Resolving pod";
  if (status === "ready") {
    return image ? `${target} - ${image}` : target;
  }
  if (status === "error") {
    return "Terminal connection failed";
  }
  if (status === "closed") {
    return "Terminal session closed";
  }
  return image ? `Connecting - ${image}` : "Connecting";
}

let terminalLineId = 0;

function nextTerminalLineId() {
  terminalLineId += 1;
  return terminalLineId;
}

function terminalLineClassName(tone: TerminalLine["tone"]): string {
  switch (tone) {
    case "error":
      return "whitespace-pre-wrap text-red-300";
    case "success":
      return "whitespace-pre-wrap text-emerald-300";
    case "muted":
      return "whitespace-pre-wrap text-zinc-400";
    default:
      return "whitespace-pre-wrap text-zinc-100";
  }
}

function appendOutput(lines: TerminalLine[], value: string): TerminalLine[] {
  const chunks = value.replace(/\r/g, "").split("\n");
  const next = [...lines];
  chunks.forEach((chunk, index) => {
    if (index === 0 && next.length > 0) {
      const last = next.at(-1);
      if (last !== undefined) {
        next[next.length - 1] = { ...last, value: `${last.value}${chunk}` };
      }
      return;
    }
    next.push({ id: nextTerminalLineId(), value: chunk });
  });
  return next.slice(-500);
}

function parseTerminalMessage(data: MessageEvent["data"]) {
  const raw = typeof data === "string" ? data : "";
  if (raw === "") {
    return null;
  }
  try {
    return JSON.parse(raw) as TerminalServerMessage;
  } catch {
    return {
      type: "output" as const,
      value: raw,
    };
  }
}

export const WorkloadTerminalPane = memo(function WorkloadTerminalPane({
  node,
  onClose,
}: {
  node: Node;
  onClose: () => void;
}) {
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const ns = useAtomValue(namespaceAtom).trim();
  const states = containerStatesFromNode(node);
  const namespace = states?.namespace?.trim() || ns;
  const name = states?.name?.trim() ?? "";
  const [container, setContainer] = useState("");
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [pod, setPod] = useState("");
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const canConnect =
    kubeconfig.trim() !== "" && namespace !== "" && name !== "";
  const subtitle = useMemo(
    () => terminalSubtitle({ container, pod, states, status }),
    [container, pod, states, status]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
    });
  });

  useEffect(() => {
    setLines([]);
    setPod("");
    setContainer("");
    if (!canConnect) {
      setStatus("error");
      setLines([
        {
          id: nextTerminalLineId(),
          tone: "error",
          value: "Missing kubeconfig, namespace, or workload name.",
        },
      ]);
      return;
    }

    let active = true;
    const socket = new WebSocket(workloadTerminalWebSocketUrl());
    socketRef.current = socket;
    setStatus("connecting");
    setLines([
      {
        id: nextTerminalLineId(),
        tone: "muted",
        value: `Connecting to ${name}...`,
      },
    ]);

    socket.addEventListener("open", () => {
      if (!active) {
        socket.close();
        return;
      }
      socket.send(
        JSON.stringify({
          kubeconfig,
          name,
          namespace,
          type: "init",
        })
      );
    });

    socket.addEventListener("message", (event) => {
      if (!active) {
        return;
      }
      const message = parseTerminalMessage(event.data);
      if (message === null) {
        return;
      }
      if (message.type === "ready") {
        setPod(message.pod ?? "");
        setContainer(message.container ?? "");
        setStatus("ready");
        setLines((current) => [
          ...current,
          {
            id: nextTerminalLineId(),
            tone: "success",
            value: `Connected to ${message.pod ?? name}${message.container ? ` (${message.container})` : ""}`,
          },
        ]);
        return;
      }
      if (message.type === "error") {
        setStatus("error");
        setLines((current) => [
          ...current,
          {
            id: nextTerminalLineId(),
            tone: "error",
            value: message.message ?? "Terminal error.",
          },
        ]);
        return;
      }
      if (message.type === "output") {
        setLines((current) => appendOutput(current, message.value ?? ""));
      }
    });

    socket.addEventListener("close", () => {
      if (!active) {
        return;
      }
      setStatus((current) => (current === "error" ? current : "closed"));
    });

    socket.addEventListener("error", () => {
      if (!active) {
        return;
      }
      setStatus("error");
      setLines((current) => [
        ...current,
        {
          id: nextTerminalLineId(),
          tone: "error",
          value: "WebSocket connection failed.",
        },
      ]);
    });

    return () => {
      active = false;
      socketRef.current = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "close" }));
        socket.close();
      }
    };
  }, [canConnect, kubeconfig, name, namespace]);

  const sendInput = useCallback(
    (value: string) => {
      if (value === "") {
        return;
      }
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN || status !== "ready") {
        return;
      }
      socket.send(JSON.stringify({ type: "input", value }));
    },
    [status]
  );

  return (
    <section
      aria-label="Container instance terminal"
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex h-[38%] min-h-72 flex-col border-resource-pane-input border-t bg-[#10131a]/98 shadow-[0_-18px_60px_rgba(0,0,0,0.36)] backdrop-blur"
      data-slot="workload-terminal-plane"
    >
      <header className="flex h-15 shrink-0 items-center gap-3 border-resource-pane-input border-b px-6">
        <SquareTerminal aria-hidden className="size-4 shrink-0 text-blue-500" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate font-semibold text-lg text-zinc-100">
              {terminalTitle(states)}
            </h2>
            <span className="inline-flex min-w-0 items-center gap-2 text-sm text-zinc-400">
              <Circle
                aria-hidden
                className="size-3 shrink-0 fill-emerald-500 text-emerald-500"
              />
              <span className="truncate">{subtitle}</span>
            </span>
          </div>
        </div>
        <Button
          aria-label="Close workload terminal"
          className="size-8 rounded-md text-zinc-200 hover:bg-white/10"
          onClick={onClose}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X aria-hidden className="size-4" />
        </Button>
      </header>
      <div
        className="min-h-0 flex-1 overflow-auto px-6 py-4 font-mono text-[13px] text-zinc-100 leading-6"
        ref={scrollRef}
      >
        {lines.map((line) => (
          <div className={terminalLineClassName(line.tone)} key={line.id}>
            {line.value || " "}
          </div>
        ))}
      </div>
      <form
        className="flex min-w-0 items-center gap-2 border-resource-pane-input border-t px-6 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          sendInput(`${input}\n`);
          setInput("");
        }}
      >
        <span className="shrink-0 font-mono text-blue-400 text-sm">$</span>
        <input
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={status !== "ready"}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            status === "ready" ? "Type a command..." : "Connecting terminal..."
          }
          value={input}
        />
      </form>
    </section>
  );
});

WorkloadTerminalPane.displayName = "WorkloadTerminalPane";
