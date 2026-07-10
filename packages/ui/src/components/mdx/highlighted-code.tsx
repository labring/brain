"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import { Check, Copy } from "lucide-react";
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

const DARK_THEME = "aurora-x";
const LIGHT_THEME = "aurora-x";

const TRAILING_NEWLINE = /\n$/;

const SHIKI_PRE_CLASS =
  "!m-0 !bg-transparent min-w-0 overflow-x-auto px-3.5 py-3 font-mono text-[0.8125rem] font-normal leading-5 [font-variant-ligatures:none]";

const SHIKI_CODE_CLASS =
  "font-mono text-[0.8125rem] font-normal leading-5 [font-variant-ligatures:none]";

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
  // Lazy so shiki stays out of eager route chunks; the plain-text fallback
  // in HighlightedCodeBody covers the load window.
  const { codeToHtml } = await import("shiki");
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
    highlightCode(codeString, lang)
      .then(setHtml)
      .catch(() => undefined);
  }, [codeString, lang, inline]);

  const copy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    navigator.clipboard
      .writeText(codeString)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
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
        "group/code not-prose relative my-3 overflow-hidden rounded-md border border-border/70 bg-background/45 text-foreground",
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
        "flex h-8 items-center justify-between border-border/60 border-b bg-muted/20 px-3 font-medium text-xs",
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
        "font-mono text-[11px] text-muted-foreground leading-none",
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

  const label = copied ? "Copied code" : "Copy code";

  return (
    <AppIconButton
      aria-label={label}
      className={cn(
        "-mr-1 size-6 rounded-md text-muted-foreground",
        "pointer-events-none opacity-0 transition-opacity duration-150",
        "group-hover/code:pointer-events-auto group-hover/code:opacity-100",
        "group-focus-within/code:pointer-events-auto group-focus-within/code:opacity-100",
        "focus-visible:pointer-events-auto focus-visible:opacity-100",
        "hover:bg-input/50 hover:text-foreground",
        copied && "pointer-events-auto text-foreground opacity-100",
        className
      )}
      onClick={copy}
      size="sm"
      title={label}
      type="button"
      variant="quiet"
    >
      {copied ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
    </AppIconButton>
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
        "[&_.shiki]:font-normal [&_.shiki]:text-[0.8125rem]",
        "[&_pre]:m-0! [&_pre]:bg-transparent!",
        "[&_code]:font-normal [&_code]:text-[0.8125rem]",
        "[&_span.line]:text-[0.8125rem]",
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
        "rounded-sm border border-border/60 bg-input/30 box-decoration-clone px-1.5 py-0.5 font-mono text-[0.85em] text-foreground [font-variant-ligatures:none] [overflow-wrap:anywhere]",
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
