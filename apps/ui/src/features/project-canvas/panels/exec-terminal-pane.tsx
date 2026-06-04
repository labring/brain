"use client";

import "@xterm/xterm/css/xterm.css";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import type { Terminal as TerminalType } from "@xterm/xterm";
import { useAtomValue } from "jotai";
import { SquareTerminal, X } from "lucide-react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { kubeconfigAtom } from "@/store/auth-store";
import { workloadTerminalWebSocketUrl } from "./workload-terminal-url";

type TerminalStatus = "connecting" | "closed" | "error" | "ready";

const DEFAULT_TERMINAL_HEIGHT = 315;
const MIN_TERMINAL_HEIGHT = 288;
const TERMINAL_HEIGHT_STEP = 24;
const TERMINAL_VIEWPORT_GUTTER = 32;
const TERMINAL_VIEWPORT_MAX_RATIO = 0.8;
const TERMINAL_RENDERER_BACKGROUND = "#13151C";

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

function resolveTerminalMaxHeight(section: HTMLElement | null): number {
  const viewportHeight =
    typeof window === "undefined" ? 720 : window.innerHeight;
  const parentHeight = section?.parentElement?.getBoundingClientRect().height;
  const availableHeight =
    (parentHeight && parentHeight > 0 ? parentHeight : viewportHeight) -
    TERMINAL_VIEWPORT_GUTTER;
  const viewportMax = viewportHeight * TERMINAL_VIEWPORT_MAX_RATIO;

  return Math.max(
    MIN_TERMINAL_HEIGHT,
    Math.floor(Math.min(availableHeight, viewportMax))
  );
}

function clampTerminalHeight(height: number, maxHeight: number): number {
  return Math.round(Math.min(Math.max(height, MIN_TERMINAL_HEIGHT), maxHeight));
}

export const ExecTerminalPane = memo(function ExecTerminalPane({
  descriptor,
  onClose,
}: {
  descriptor: ExecTerminalDescriptor;
  onClose: () => void;
}) {
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const [, setStatus] = useState<TerminalStatus>("connecting");
  const [isResizing, setIsResizing] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT);
  const [maxTerminalHeight, setMaxTerminalHeight] = useState(
    DEFAULT_TERMINAL_HEIGHT
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const resizeDragRef = useRef<{
    startHeight: number;
    startY: number;
  } | null>(null);

  const { kind, name, namespace, projectUid } = descriptor;
  const canConnect =
    kubeconfig.trim() !== "" && name !== "" && namespace !== "";

  const updateTerminalHeight = useCallback((nextHeight: number) => {
    const nextMaxHeight = resolveTerminalMaxHeight(sectionRef.current);
    setMaxTerminalHeight(nextMaxHeight);
    setTerminalHeight(clampTerminalHeight(nextHeight, nextMaxHeight));
  }, []);

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      const currentHeight =
        sectionRef.current?.getBoundingClientRect().height ?? terminalHeight;
      const nextMaxHeight = resolveTerminalMaxHeight(sectionRef.current);

      setMaxTerminalHeight(nextMaxHeight);
      resizeDragRef.current = {
        startHeight: currentHeight,
        startY: event.clientY,
      };
      setIsResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [terminalHeight]
  );

  const resize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = resizeDragRef.current;
      if (drag === null) {
        return;
      }
      updateTerminalHeight(drag.startHeight + drag.startY - event.clientY);
      event.preventDefault();
    },
    [updateTerminalHeight]
  );

  const endResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (resizeDragRef.current === null) {
      return;
    }
    resizeDragRef.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const currentHeight =
        sectionRef.current?.getBoundingClientRect().height ?? terminalHeight;
      const nextMaxHeight = resolveTerminalMaxHeight(sectionRef.current);

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMaxTerminalHeight(nextMaxHeight);
        setTerminalHeight(
          clampTerminalHeight(
            currentHeight + TERMINAL_HEIGHT_STEP,
            nextMaxHeight
          )
        );
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMaxTerminalHeight(nextMaxHeight);
        setTerminalHeight(
          clampTerminalHeight(
            currentHeight - TERMINAL_HEIGHT_STEP,
            nextMaxHeight
          )
        );
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setMaxTerminalHeight(nextMaxHeight);
        setTerminalHeight(MIN_TERMINAL_HEIGHT);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setMaxTerminalHeight(nextMaxHeight);
        setTerminalHeight(nextMaxHeight);
      }
    },
    [terminalHeight]
  );

  useEffect(() => {
    const updateMaxHeight = () => {
      const nextMaxHeight = resolveTerminalMaxHeight(sectionRef.current);
      setMaxTerminalHeight(nextMaxHeight);
      setTerminalHeight((currentHeight) =>
        clampTerminalHeight(currentHeight, nextMaxHeight)
      );
    };

    updateMaxHeight();
    window.addEventListener("resize", updateMaxHeight);
    return () => window.removeEventListener("resize", updateMaxHeight);
  }, []);

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
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
        fontSize: 14,
        lineHeight: 1.43,
        theme: {
          background: TERMINAL_RENDERER_BACKGROUND,
          cursor: "#fafafa",
          foreground: "#e5e5e5",
          selectionBackground: "rgba(59, 130, 246, 0.32)",
        },
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
      aria-label="Terminal session"
      className={cn(
        "project-chrome-surface pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex max-h-[80vh] min-h-72 flex-col overflow-hidden border-t text-zinc-50 shadow-[0_-18px_60px_rgba(0,0,0,0.36)]",
        isResizing ? "border-input" : "border-white/10"
      )}
      data-slot="exec-terminal-plane"
      ref={sectionRef}
      style={{
        height: terminalHeight,
      }}
    >
      <hr
        aria-label="Resize terminal"
        aria-orientation="horizontal"
        aria-valuemax={maxTerminalHeight}
        aria-valuemin={MIN_TERMINAL_HEIGHT}
        aria-valuenow={terminalHeight}
        className="absolute inset-x-0 top-0 z-10 h-3 -translate-y-1/2 cursor-ns-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onKeyDown={handleResizeKeyDown}
        onPointerCancel={endResize}
        onPointerDown={beginResize}
        onPointerMove={resize}
        onPointerUp={endResize}
        tabIndex={0}
      />
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 py-2.5 drop-shadow-[0_4px_2px_rgba(0,0,0,0.25)]">
        <div className="flex min-w-0 items-center gap-2">
          <SquareTerminal
            aria-hidden
            className="size-4 shrink-0 text-blue-400"
          />
          <h2 className="truncate font-semibold text-lg text-zinc-50 leading-7">
            {descriptor.title || "Terminal"}
          </h2>
        </div>
        <div className="shrink-0">
          <AppIconButton
            aria-label="Close terminal"
            className="text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
            onClick={onClose}
            size="lg"
            type="button"
            variant="quiet"
          >
            <X aria-hidden className="size-4" />
          </AppIconButton>
        </div>
      </header>
      <div
        className="[&_.xterm-scrollable-element]:!bg-transparent [&_.xterm-viewport]:!bg-transparent min-h-0 flex-1 overflow-hidden [&_.xterm-viewport]:[scrollbar-color:rgba(255,255,255,0.15)_transparent] [&_.xterm-viewport]:[scrollbar-width:thin] [&_.xterm]:h-full"
        data-slot="exec-terminal-surface"
      >
        <div className="h-full px-4 pt-2 pb-4" ref={containerRef} />
      </div>
    </section>
  );
});

ExecTerminalPane.displayName = "ExecTerminalPane";
