"use client";

import { ClipboardCopyIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ShikiTransformer } from "shiki";
import { codeToHtml } from "shiki";

const DARK_THEME = "aurora-x";
const LIGHT_THEME = "aurora-x";

const TRAILING_NEWLINE = /\n$/;

const SHIKI_PRE_CLASS =
  "!m-0 !bg-transparent min-w-0 overflow-x-auto px-4 py-2 font-mono text-sm font-normal leading-normal";

const SHIKI_CODE_CLASS = "font-mono text-sm font-normal leading-normal";

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const transformers: ShikiTransformer[] = [
  {
    pre(node) {
      node.properties.class = cn(
        node.properties.class as string | undefined,
        SHIKI_PRE_CLASS
      );
    },
    code(node) {
      node.properties.class = cn(
        node.properties.class as string | undefined,
        SHIKI_CODE_CLASS
      );
    },
  },
];

async function highlightCode(code: string, lang: string) {
  return await codeToHtml(code, {
    lang: lang || "text",
    themes: {
      dark: DARK_THEME,
      light: LIGHT_THEME,
    },
    transformers,
  });
}

// --- Context contract (state / actions / meta) ---

export interface HighlightedCodeState {
  codeString: string;
  copied: boolean;
  html: string;
  inline: boolean;
  lang: string;
}

export interface HighlightedCodeActions {
  copy: () => void;
}

export interface HighlightedCodeMeta {
  showCopy: boolean;
  showLanguage: boolean;
}

export interface HighlightedCodeContextValue {
  actions: HighlightedCodeActions;
  meta: HighlightedCodeMeta;
  state: HighlightedCodeState;
}

const HighlightedCodeContext =
  createContext<HighlightedCodeContextValue | null>(null);

function useHighlightedCode() {
  const ctx = useContext(HighlightedCodeContext);
  if (!ctx) {
    throw new Error(
      "HighlightedCode compound parts must be used within HighlightedCode.Provider"
    );
  }
  return ctx;
}

export function HighlightedCodeProvider({
  children,
  code,
  language = "text",
  inline = false,
  showCopy = true,
  showLanguage = true,
}: {
  children: ReactNode;
  code: string;
  inline?: boolean;
  language?: string;
  showCopy?: boolean;
  showLanguage?: boolean;
}) {
  const codeString = code.replace(TRAILING_NEWLINE, "");
  const lang = language || "text";
  const [html, setHtml] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (inline) {
      return;
    }
    highlightCode(codeString, lang).then(setHtml);
  }, [codeString, lang, inline]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [codeString]);

  const value = useMemo<HighlightedCodeContextValue>(
    () => ({
      actions: { copy },
      meta: { showCopy, showLanguage },
      state: { codeString, copied, html, inline, lang },
    }),
    [copy, codeString, copied, html, inline, lang, showCopy, showLanguage]
  );

  return (
    <HighlightedCodeContext.Provider value={value}>
      {children}
    </HighlightedCodeContext.Provider>
  );
}

export function HighlightedCodeRoot({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "group/code not-prose relative my-4 overflow-hidden rounded-lg border border-border bg-muted/40",
        className
      )}
      {...props}
    />
  );
}

export function HighlightedCodeHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-border/60 border-b px-3 py-1.5 font-medium text-xs",
        className
      )}
      {...props}
    />
  );
}

export function HighlightedCodeLanguage({ className }: { className?: string }) {
  const {
    meta: { showLanguage },
    state: { lang },
  } = useHighlightedCode();

  return (
    <span
      className={cn(
        "font-mono text-[11px] text-muted-foreground uppercase tracking-wider",
        className
      )}
    >
      {showLanguage ? lang : ""}
    </span>
  );
}

export function HighlightedCodeCopyButton({
  className,
}: {
  className?: string;
}) {
  const {
    actions: { copy },
    meta: { showCopy },
    state: { copied },
  } = useHighlightedCode();

  if (!showCopy) {
    return null;
  }

  return (
    <button
      aria-label="Copy code"
      className={cn(
        "-mr-1 flex cursor-pointer items-center gap-1.5 rounded-md p-1 text-muted-foreground transition-colors",
        "pointer-events-none opacity-0 transition-opacity duration-150",
        "group-hover/code:pointer-events-auto group-hover/code:opacity-100",
        "focus-visible:pointer-events-auto focus-visible:opacity-100",
        copied && "pointer-events-auto opacity-100",
        "hover:bg-input/50 hover:text-foreground",
        className
      )}
      onClick={copy}
      type="button"
    >
      {copied ? (
        <HugeiconsIcon icon={Tick01Icon} size={14} />
      ) : (
        <HugeiconsIcon icon={ClipboardCopyIcon} size={14} />
      )}
    </button>
  );
}

export function HighlightedCodeBody({ className }: { className?: string }) {
  const {
    state: { codeString, html },
  } = useHighlightedCode();

  const fallbackMarkup = `<pre class="${SHIKI_PRE_CLASS}"><code class="${SHIKI_CODE_CLASS}">${escapeHtml(codeString)}</code></pre>`;

  return (
    <div
      className={cn(
        "[&_.shiki]:font-normal [&_.shiki]:text-sm",
        "[&_pre]:m-0! [&_pre]:bg-transparent!",
        "[&_code]:font-normal [&_code]:text-sm",
        "[&_span.line]:text-sm",
        className
      )}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki HTML is safe
      dangerouslySetInnerHTML={{
        __html: html || fallbackMarkup,
      }}
    />
  );
}

export function HighlightedCodeInline({
  className,
  ...props
}: ComponentProps<"code">) {
  const {
    state: { codeString },
  } = useHighlightedCode();

  return (
    <code
      className={cn(
        "rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground",
        className
      )}
      {...props}
    >
      {codeString}
    </code>
  );
}

export const HighlightedCode = {
  Body: HighlightedCodeBody,
  CopyButton: HighlightedCodeCopyButton,
  Header: HighlightedCodeHeader,
  Inline: HighlightedCodeInline,
  Language: HighlightedCodeLanguage,
  Provider: HighlightedCodeProvider,
  Root: HighlightedCodeRoot,
};
