"use client";

import { HighlightedCode } from "@workspace/ui/components/mdx/highlighted-code";
import { MermaidDiagram } from "@workspace/ui/components/mdx/mermaid-diagram";
import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";
import type { Components } from "streamdown";

const LANGUAGE_CLASS = /language-(\w+)/;
const TRAILING_NEWLINE = /\n$/;

function MarkdownCodeBlock({
  className,
  code,
  language,
}: {
  className?: string;
  code: string;
  language: string;
}) {
  return (
    <HighlightedCode.Provider code={code} inline={false} language={language}>
      <HighlightedCode.Root className={className}>
        <HighlightedCode.Header>
          <HighlightedCode.Language />
          <HighlightedCode.CopyButton />
        </HighlightedCode.Header>
        <HighlightedCode.Body />
      </HighlightedCode.Root>
    </HighlightedCode.Provider>
  );
}

type FootnoteAnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  "data-footnote-ref"?: boolean;
  "data-footnote-backref"?: string | boolean | "";
};

/**
 * Shared markdown element map for MDX, react-markdown, and Streamdown (`MessageResponse`).
 */
export const markdownComponents = {
  h1: ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1
      className={cn(
        "mt-5 scroll-m-20 font-heading font-semibold text-base leading-6 first:mt-0",
        className
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className={cn(
        "mt-5 scroll-m-20 font-heading font-semibold text-[0.95rem] leading-6 first:mt-0",
        className
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3
      className={cn(
        "mt-4 scroll-m-20 font-heading font-semibold text-sm leading-6 first:mt-0",
        className
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4
      className={cn(
        "mt-4 scroll-m-20 font-heading font-semibold text-sm leading-6 first:mt-0",
        className
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h5
      className={cn(
        "mt-4 scroll-m-20 font-semibold text-sm leading-6 first:mt-0",
        className
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h6
      className={cn(
        "mt-4 scroll-m-20 font-semibold text-muted-foreground text-sm leading-6 first:mt-0",
        className
      )}
      {...props}
    />
  ),
  a: ({
    className,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const p = props as FootnoteAnchorProps;
    const footnoteRef = p["data-footnote-ref"] === true;
    const footnoteBackref = p["data-footnote-backref"] !== undefined;

    if (footnoteRef) {
      return (
        <a
          className={cn(
            "font-medium text-muted-foreground tabular-nums no-underline [overflow-wrap:anywhere] hover:text-foreground",
            className
          )}
          {...props}
        />
      );
    }
    if (footnoteBackref) {
      return (
        <a
          className={cn(
            "text-muted-foreground no-underline [overflow-wrap:anywhere] hover:text-foreground",
            className
          )}
          {...props}
        />
      );
    }
    return (
      <a
        className={cn(
          "font-medium text-brand-primary underline underline-offset-4 transition-colors [overflow-wrap:anywhere] hover:text-brand-primary-hover",
          className
        )}
        {...props}
      />
    );
  },
  section: ({
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement>) => {
    const isFootnotes =
      (
        props as React.HTMLAttributes<HTMLElement> & {
          "data-footnotes"?: boolean;
        }
      )["data-footnotes"] === true;
    if (isFootnotes) {
      return (
        <section
          className={cn(
            "mt-10 border-border border-t pt-6 text-muted-foreground text-sm [&_ol]:my-0 [&_ol]:ml-0 [&_ol]:pl-4",
            className
          )}
          {...props}
        >
          {children}
        </section>
      );
    }
    return (
      <section className={className} {...props}>
        {children}
      </section>
    );
  },
  p: ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p
      className={cn("not-first:mt-3 max-w-[75ch] leading-6", className)}
      {...props}
    />
  ),
  ul: ({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className={cn(
        "my-3 ml-4 list-disc space-y-1 marker:text-muted-foreground",
        className
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className={cn(
        "my-3 ml-4 list-decimal space-y-1 marker:text-muted-foreground",
        "[&_ol]:list-[lower-alpha]!",
        "[&_ol_ol]:list-[lower-roman]!",
        className
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <li
      className={cn(
        "pl-1 leading-6 [&>p:not(:first-child)]:mt-2 [&>p]:my-0",
        className
      )}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <blockquote
      className={cn(
        "my-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-muted-foreground text-sm leading-6 [&>p]:max-w-none [&>p]:leading-6",
        className
      )}
      {...props}
    />
  ),
  img: ({
    className,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // biome-ignore lint/correctness/useImageSize: MDX/markdown images have arbitrary dimensions
    <img
      alt={alt}
      className={cn(
        "my-3 max-w-full rounded-md border border-border/70",
        className
      )}
      {...props}
    />
  ),
  hr: ({ ...props }: React.HTMLAttributes<HTMLHRElement>) => (
    <hr className="my-4 border-border/70" {...props} />
  ),
  table: ({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-3 w-full overflow-x-auto rounded-md border border-border/70">
      <table
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      />
    </div>
  ),
  tr: ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr
      className={cn("border-border/70 border-b last:border-b-0", className)}
      {...props}
    />
  ),
  th: ({ className, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th
      className={cn(
        "bg-muted/30 px-3 py-2 text-left font-medium text-muted-foreground [[align=center]]:text-center [[align=right]]:text-right",
        className
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td
      className={cn(
        "px-3 py-2 text-left align-top [[align=center]]:text-center [[align=right]]:text-right",
        className
      )}
      {...props}
    />
  ),
  pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => <>{children}</>,
  code: ({
    children,
    className: codeClassName,
  }: React.HTMLAttributes<HTMLElement>) => {
    const match = LANGUAGE_CLASS.exec(codeClassName || "");
    const language = match?.[1] ?? "text";
    const codeString = String(children).replace(TRAILING_NEWLINE, "");
    const isBlock = Boolean(match) || codeString.includes("\n");

    if (!isBlock) {
      return (
        <HighlightedCode.Provider code={codeString} inline language={language}>
          <HighlightedCode.Inline className={codeClassName} />
        </HighlightedCode.Provider>
      );
    }

    const block = (
      <MarkdownCodeBlock
        className={codeClassName}
        code={codeString}
        language={language}
      />
    );
    // Mermaid fences upgrade to a rendered diagram once complete; the
    // highlighted source stays as the streaming and parse-failure fallback.
    return language === "mermaid" ? (
      <MermaidDiagram chart={codeString} fallback={block} />
    ) : (
      block
    );
  },
} as Components;

/** Alias for MDX / react-markdown docs that use `components`. */
export const components = markdownComponents;
