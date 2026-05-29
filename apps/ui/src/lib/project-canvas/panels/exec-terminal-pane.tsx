"use client";

import "@xterm/xterm/css/xterm.css";

import { Button } from "@workspace/ui/components/button";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import type { Terminal as TerminalType } from "@xterm/xterm";
import { useAtomValue } from "jotai";
import { Circle, SquareTerminal, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import { kubeconfigAtom } from "@/store/auth-store";
import { workloadTerminalWebSocketUrl } from "./workload-terminal-url";

type TerminalStatus = "connecting" | "closed" | "error" | "ready";

interface TerminalServerMessage {
  message?: string;
  type: "close" | "error" | "output" | "ready";
  value?: string;
}

/**
 * The exec target for a bottom-plane terminal session. AP and DB nodes both
 * produce one of these; they differ only by `kind` (which selects the
 * server-side resolver) and labels.
 */
export interface ExecTerminalDescriptor {
  kind: "ap" | "db";
  name: string;
  namespace: string;
  /** Required for `kind: "db"`; the server enforces project ownership. */
  projectUid?: string;
  subtitle: string;
  title: string;
}

function parseTerminalMessage(
  data: MessageEvent["data"]
): TerminalServerMessage | null {
  const raw = typeof data === "string" ? data : "";
  if (raw === "") {
    return null;
  }
  try {
    return JSON.parse(raw) as TerminalServerMessage;
  } catch {
    return { type: "output", value: raw };
  }
}

function statusDotClassName(status: TerminalStatus): string {
  switch (status) {
    case "ready":
      return "fill-emerald-500 text-emerald-500";
    case "error":
      return "fill-red-500 text-red-500";
    case "closed":
      return "fill-zinc-500 text-zinc-500";
    default:
      return "fill-amber-500 text-amber-500";
  }
}

function statusLabel(status: TerminalStatus, subtitle: string): string {
  switch (status) {
    case "ready":
      return subtitle;
    case "error":
      return "Connection failed";
    case "closed":
      return "Session closed";
    default:
      return "Connecting…";
  }
}

export const ExecTerminalPane = memo(function ExecTerminalPane({
  descriptor,
  onClose,
}: {
  descriptor: ExecTerminalDescriptor;
  onClose: () => void;
}) {
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { kind, name, namespace, projectUid } = descriptor;
  const canConnect =
    kubeconfig.trim() !== "" && name !== "" && namespace !== "";

  useEffect(() => {
    const mount = containerRef.current;
    if (mount === null) {
      return;
    }
    if (!canConnect) {
      setStatus("error");
      return;
    }

    let disposed = false;
    let term: TerminalType | null = null;
    let fit: FitAddonType | null = null;
    let socket: WebSocket | null = null;
    let observer: ResizeObserver | null = null;
    setStatus("connecting");

    const sendResize = () => {
      if (term === null || socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(
        JSON.stringify({ cols: term.cols, rows: term.rows, type: "resize" })
      );
    };

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) {
        return;
      }
      term = new Terminal({
        cursorBlink: true,
        fontFamily:
          "var(--font-geist-mono, ui-monospace, SFMono-Regular, monospace)",
        fontSize: 13,
        theme: { background: "#10131a", foreground: "#f4f4f5" },
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(mount);
      fit.fit();

      socket = new WebSocket(workloadTerminalWebSocketUrl());

      socket.addEventListener("open", () => {
        socket?.send(
          JSON.stringify({
            kind,
            kubeconfig,
            name,
            namespace,
            type: "init",
            ...(projectUid ? { projectUid } : {}),
          })
        );
      });

      socket.addEventListener("message", (event) => {
        const message = parseTerminalMessage(event.data);
        if (message === null) {
          return;
        }
        if (message.type === "ready") {
          setStatus("ready");
          sendResize();
          term?.focus();
          return;
        }
        if (message.type === "error") {
          setStatus("error");
          term?.write(
            `\r\n\x1b[31m${message.message ?? "Terminal error."}\x1b[0m\r\n`
          );
          return;
        }
        if (message.type === "output") {
          term?.write(message.value ?? "");
        }
      });

      socket.addEventListener("close", () => {
        setStatus((current) => (current === "error" ? current : "closed"));
      });
      socket.addEventListener("error", () => {
        setStatus("error");
      });

      term.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", value: data }));
        }
      });

      observer = new ResizeObserver(() => {
        fit?.fit();
        sendResize();
      });
      observer.observe(mount);
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "close" }));
      }
      socket?.close();
      term?.dispose();
    };
  }, [canConnect, kind, kubeconfig, name, namespace, projectUid]);

  return (
    <section
      aria-label="Workload terminal"
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex h-[38%] min-h-72 flex-col border-resource-pane-input border-t bg-[#10131a]/98 shadow-[0_-18px_60px_rgba(0,0,0,0.36)] backdrop-blur"
      data-slot="exec-terminal-plane"
    >
      <header className="flex h-15 shrink-0 items-center gap-3 border-resource-pane-input border-b px-6">
        <SquareTerminal aria-hidden className="size-4 shrink-0 text-blue-500" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate font-semibold text-lg text-zinc-100">
              {descriptor.title || "Terminal"}
            </h2>
            <span className="inline-flex min-w-0 items-center gap-2 text-sm text-zinc-400">
              <Circle
                aria-hidden
                className={`size-3 shrink-0 ${statusDotClassName(status)}`}
              />
              <span className="truncate">
                {statusLabel(status, descriptor.subtitle)}
              </span>
            </span>
          </div>
        </div>
        <Button
          aria-label="Close terminal"
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
        className="min-h-0 flex-1 overflow-hidden px-4 py-3"
        data-slot="exec-terminal-surface"
        ref={containerRef}
      />
    </section>
  );
});

ExecTerminalPane.displayName = "ExecTerminalPane";
