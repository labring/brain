"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface ProjectTopBarSlotAttachment {
  host: HTMLElement | null;
  setHost: (host: HTMLElement | null) => void;
}

const ProjectTopBarSlotContext =
  createContext<ProjectTopBarSlotAttachment | null>(null);

/**
 * Slot contract between the project top bar and page modules: the top bar
 * rents out a region of its row without knowing what fills it, and a page
 * module (today: the Project Canvas workbench's Deployment Task Dock) mounts
 * content there while keeping ownership — data, callbacks, and state stay in
 * the contributing module's React tree; only the DOM output travels.
 */
export function ProjectTopBarSlotProvider({
  children,
}: {
  children: ReactNode;
}) {
  // useState (not useRef) so the host element's mount re-renders consumers,
  // giving the portal a target to attach to.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const attachment = useMemo<ProjectTopBarSlotAttachment>(
    () => ({ host, setHost }),
    [host]
  );
  return (
    <ProjectTopBarSlotContext.Provider value={attachment}>
      {children}
    </ProjectTopBarSlotContext.Provider>
  );
}

/** The top bar's rented region: an empty element slot content portals into. */
export function ProjectTopBarSlotHost({ className }: { className?: string }) {
  const attachment = useContext(ProjectTopBarSlotContext);
  if (attachment == null) {
    return null;
  }
  return (
    <div
      className={className}
      data-slot="project-top-bar-slot"
      ref={attachment.setHost}
    />
  );
}

/**
 * Mounts its children into the project top bar's slot from anywhere under the
 * provider. Outside a provider (chrome-less hosts, tests) children render in
 * place, mirroring SidePaneFooter's fallback.
 */
export function ProjectTopBarSlot({ children }: { children: ReactNode }) {
  const attachment = useContext(ProjectTopBarSlotContext);
  if (attachment == null) {
    return <>{children}</>;
  }
  if (attachment.host == null) {
    return null;
  }
  return createPortal(children, attachment.host);
}
