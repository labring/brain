import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ICON_CHEVRON, ICON_PANEL } from "../icons";

interface FolderProps {
  children: ReactNode;
  defaultOpen?: boolean;
  /** Root folder only: fill the parent instead of sizing to content (frame posture). */
  fill?: boolean;
  /** Root folder only: chrome controls rendered in the title row while open. */
  headerActions?: ReactNode;
  inline?: boolean;
  isRoot?: boolean;
  /** Root folder only: enabled Dev Mock count; above zero the collapsed
   * launcher takes its mock form (an amber capsule instead of the bubble). */
  mockCount?: number;
  onOpenChange?: (isOpen: boolean) => void;
  /** Controlled open state; leave undefined for the internal default-open state. */
  open?: boolean;
  panelHeightOffset?: number;
  title: ReactNode;
  toolbar?: ReactNode;
}

function PanelGlyph({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 16 16"
    >
      <path d={ICON_PANEL.path} fill="currentColor" opacity="0.5" />
      {ICON_PANEL.circles.map((c) => (
        <circle
          cx={c.cx}
          cy={c.cy}
          fill="currentColor"
          key={`${c.cx}-${c.cy}`}
          r={c.r}
          stroke="currentColor"
          strokeWidth="1.25"
        />
      ))}
    </svg>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported panel logic kept structurally intact
export function Folder({
  title,
  children,
  defaultOpen = true,
  fill = false,
  headerActions,
  isRoot = false,
  inline = false,
  mockCount = 0,
  onOpenChange,
  open,
  toolbar,
  panelHeightOffset = 0,
}: FolderProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const isCollapsed = !isOpen;
  const mockForm = isRoot && !inline && !isOpen && mockCount > 0;
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(
    undefined
  );
  const [windowHeight, setWindowHeight] = useState(
    typeof window === "undefined" ? 800 : window.innerHeight
  );

  useEffect(() => {
    if (!isRoot) {
      return;
    }
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isRoot]);

  // Track content height for explicit panel sizing (no height: 'auto')
  useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => {
      if (isOpen) {
        const h = el.offsetHeight;
        setContentHeight((prev) => (prev === h ? prev : h));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen]);

  const handleToggle = () => {
    if (inline && isRoot) {
      return;
    }
    const next = !isOpen;
    if (open === undefined) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  const folderContent = (
    <div
      className={`dev-tweaks-folder ${isRoot ? "dev-tweaks-folder-root" : ""}`}
      data-open={String(isOpen)}
      ref={isRoot ? contentRef : undefined}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: header can host a nested interactive toolbar, so role="button" would nest controls invalidly */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: header can host a nested interactive toolbar, so role="button" would nest controls invalidly */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: header can host a nested interactive toolbar, so role="button" would nest controls invalidly */}
      <div
        className={`dev-tweaks-folder-header ${isRoot ? "dev-tweaks-panel-header" : ""}`}
        onClick={handleToggle}
      >
        <div className="dev-tweaks-folder-header-top">
          {isRoot ? (
            isOpen && (
              <div className="dev-tweaks-folder-title-row">
                <span className="dev-tweaks-folder-title dev-tweaks-folder-title-root">
                  {title}
                </span>
              </div>
            )
          ) : (
            <div className="dev-tweaks-folder-title-row">
              <span className="dev-tweaks-folder-title">{title}</span>
            </div>
          )}
          {isRoot && !inline && !isOpen && (
            <PanelGlyph className="dev-tweaks-panel-icon" />
          )}
          {isRoot && isOpen && headerActions && (
            // biome-ignore lint/a11y/noStaticElementInteractions: click handler only stops propagation to the folder header; not an interactive control
            // biome-ignore lint/a11y/noNoninteractiveElementInteractions: click handler only stops propagation to the folder header; not an interactive control
            // biome-ignore lint/a11y/useKeyWithClickEvents: click handler only stops propagation to the folder header; not an interactive control
            <div
              className="dev-tweaks-header-actions"
              onClick={(e) => e.stopPropagation()}
            >
              {headerActions}
            </div>
          )}
          {!isRoot && (
            <motion.svg
              animate={{ rotate: isOpen ? 0 : 180 }}
              className="dev-tweaks-folder-icon"
              fill="none"
              initial={false}
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              transition={{
                type: "spring",
                visualDuration: 0.35,
                bounce: 0.15,
              }}
              viewBox="0 0 24 24"
            >
              <path d={ICON_CHEVRON} />
            </motion.svg>
          )}
        </div>

        {isRoot && toolbar && isOpen && (
          // biome-ignore lint/a11y/noStaticElementInteractions: click handler only stops propagation to the folder header; not an interactive control
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: click handler only stops propagation to the folder header; not an interactive control
          // biome-ignore lint/a11y/useKeyWithClickEvents: click handler only stops propagation to the folder header; not an interactive control
          <div
            className="dev-tweaks-panel-toolbar"
            onClick={(e) => e.stopPropagation()}
          >
            {toolbar}
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            animate={isRoot ? undefined : { height: "auto", opacity: 1 }}
            className="dev-tweaks-folder-content"
            exit={isRoot ? undefined : { height: 0, opacity: 0 }}
            initial={isRoot ? undefined : { height: 0, opacity: 0 }}
            style={isRoot ? undefined : { clipPath: "inset(0 -20px)" }}
            transition={
              isRoot
                ? undefined
                : { type: "spring", visualDuration: 0.35, bounce: 0.1 }
            }
          >
            <div className="dev-tweaks-folder-inner">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  if (isRoot) {
    if (inline) {
      return (
        <div className="dev-tweaks-panel-inner dev-tweaks-panel-inline">
          {folderContent}
        </div>
      );
    }

    let openHeight: number | "auto" | "100%";
    if (fill) {
      openHeight = "100%";
    } else if (contentHeight === undefined) {
      openHeight = "auto";
    } else {
      openHeight = Math.min(
        contentHeight + panelHeightOffset,
        windowHeight - 32
      );
    }

    // Mock form keeps the collapsed launcher's chrome but lets the amber
    // capsule size to its MOCK label + count instead of the 42px circle.
    const collapsedStyle = mockForm
      ? {
          width: "fit-content" as const,
          height: 42,
          borderRadius: 21,
          boxSizing: "border-box" as const,
          boxShadow: "var(--dial-shadow-collapsed)",
          overflow: "hidden" as const,
          cursor: "pointer" as const,
        }
      : {
          width: 42,
          height: 42,
          borderRadius: "50%",
          boxSizing: "border-box" as const,
          boxShadow: "var(--dial-shadow-collapsed)",
          overflow: "hidden" as const,
          cursor: "pointer" as const,
        };
    const panelStyle = isOpen
      ? {
          width: fill ? ("100%" as const) : 280,
          height: openHeight,
          borderRadius: 14,
          boxShadow: "var(--dial-shadow)",
          cursor: undefined as string | undefined,
          overflowY: "auto" as const,
        }
      : collapsedStyle;

    return (
      <motion.div
        className="dev-tweaks-panel-inner"
        data-collapsed={isCollapsed}
        data-mock-form={mockForm ? "true" : undefined}
        onClick={isOpen ? undefined : handleToggle}
        style={panelStyle}
        transition={{ type: "spring", visualDuration: 0.15, bounce: 0.3 }}
        whileTap={isOpen ? undefined : { scale: 0.9 }}
      >
        {mockForm ? (
          // The capsule replaces the folder chrome entirely: the collapsed
          // inner is itself the click target and drag handle, and the folder
          // header's box model must not leak into the fit-content width.
          <div className="dev-tweaks-launcher-mock">
            <PanelGlyph className="dev-tweaks-launcher-mock-icon" />
            <span className="dev-tweaks-launcher-mock-label">MOCK</span>
            <span className="dev-tweaks-launcher-mock-count">{mockCount}</span>
          </div>
        ) : (
          folderContent
        )}
      </motion.div>
    );
  }

  return folderContent;
}
