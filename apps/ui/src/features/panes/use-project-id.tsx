"use client";

import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext } from "react";

const PROJECT_ROUTE_PREFIX = "/project/";

/**
 * Decoded project id from a `/project/<id>` pathname, or `undefined` when the
 * path is not a specific project route (e.g. the `/project` index). Only the
 * first path segment is read, so nested routes still resolve to their project.
 */
export function projectIdFromPathname(pathname: string): string | undefined {
  if (!pathname.startsWith(PROJECT_ROUTE_PREFIX)) {
    return undefined;
  }
  const encoded = pathname.slice(PROJECT_ROUTE_PREFIX.length).split("/")[0];
  if (!encoded) {
    return undefined;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

const ProjectIdContext = createContext<string>("");

/**
 * Provides the current project id (from `/project/<id>`) as a stable string
 * context value.
 *
 * This provider re-renders on every URL change (it reads `usePathname()`), but
 * its context value only changes when the project-id **path segment** changes.
 * A query-only write — canvas selection, side panes, timepicker — leaves the id
 * string identical, so the `Object.is`-equal context value skips every consumer.
 *
 * That indirection is the whole point: reading `useParams()` or `usePathname()`
 * directly in a consumer subscribes it to Next's router context, which notifies
 * on *every* query write (verified: Next 16 re-renders `usePathname` consumers
 * on query-only changes). Collapsing that to a single provider whose value is a
 * stable string means query writes become a no-op for everything downstream —
 * e.g. the assistant chat pane no longer re-renders when a canvas node is
 * selected.
 *
 * `children` is a stable element passed through from the parent, so this
 * provider re-rendering does not re-render the subtree; only this node runs.
 */
export function ProjectIdProvider({ children }: { children: ReactNode }) {
  const projectId = projectIdFromPathname(usePathname()) ?? "";
  return (
    <ProjectIdContext.Provider value={projectId}>
      {children}
    </ProjectIdContext.Provider>
  );
}

/** Current project id (empty string when not on a specific project route). */
export function useProjectId(): string {
  return useContext(ProjectIdContext);
}
