import type {
  CanvasViewportDirectiveStore,
  CanvasViewportDirectives,
  CanvasViewportFocusRequest,
  CanvasViewportFollowRequest,
  CanvasViewportInsets,
} from "@workspace/ui/components/canvas/canvas.types";

export interface ProjectCanvasViewportDirectiveStore
  extends CanvasViewportDirectiveStore {
  setFocus(focus: CanvasViewportFocusRequest | undefined): void;
  setFollow(follow: CanvasViewportFollowRequest | undefined): void;
  setInsets(insets: CanvasViewportInsets | undefined): void;
  setInstant(instant: boolean): void;
  setOpeningFitKey(key: number | string | undefined): void;
}

function focusRequestsEqual(
  a: CanvasViewportFocusRequest | undefined,
  b: CanvasViewportFocusRequest | undefined
): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  return (
    a.active === b.active &&
    a.fitMinZoom === b.fitMinZoom &&
    a.instant === b.instant &&
    a.key === b.key &&
    a.maxZoom === b.maxZoom &&
    a.minZoom === b.minZoom &&
    a.padding === b.padding &&
    a.nodeIds.length === b.nodeIds.length &&
    a.nodeIds.every((id, index) => id === b.nodeIds[index])
  );
}

function insetsEqual(
  a: CanvasViewportInsets | undefined,
  b: CanvasViewportInsets | undefined
): boolean {
  return a === b || (a?.bottom === b?.bottom && a?.right === b?.right);
}

function followsEqual(
  a: CanvasViewportFollowRequest | undefined,
  b: CanvasViewportFollowRequest | undefined
): boolean {
  return (
    a === b || (a?.isFollowTarget === b?.isFollowTarget && a?.key === b?.key)
  );
}

/**
 * Imperative viewport directive channel for the Project Canvas. Controllers
 * write focus/follow/insets/opening-fit directives here; the canvas view
 * subscribes. Directives never flow through canvas meta, so meta stays
 * referentially constant after mount.
 */
export function createProjectCanvasViewportDirectiveStore(): ProjectCanvasViewportDirectiveStore {
  let directives: CanvasViewportDirectives = {};
  const listeners = new Set<() => void>();

  const commit = (next: CanvasViewportDirectives) => {
    directives = next;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getDirectives() {
      return directives;
    },
    setFocus(focus) {
      if (focusRequestsEqual(directives.viewportFocus, focus)) {
        return;
      }
      commit({ ...directives, viewportFocus: focus });
    },
    setFollow(follow) {
      if (followsEqual(directives.viewportFollow, follow)) {
        return;
      }
      commit({ ...directives, viewportFollow: follow });
    },
    setInsets(insets) {
      if (insetsEqual(directives.insets, insets)) {
        return;
      }
      commit({ ...directives, insets });
    },
    setInstant(instant) {
      if ((directives.instant ?? false) === instant) {
        return;
      }
      commit({ ...directives, instant });
    },
    setOpeningFitKey(key) {
      if (directives.openingFitKey === key) {
        return;
      }
      commit({ ...directives, openingFitKey: key });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
