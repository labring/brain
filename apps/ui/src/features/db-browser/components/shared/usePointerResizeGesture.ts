import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";

export interface AnimationFrameScheduler {
  cancel: (id: number) => void;
  request: (callback: () => void) => number;
}

export interface PointerResizeSession {
  cancel?: () => void;
  commit: (clientX: number) => void;
  preview: (clientX: number) => void;
}

export interface PointerResizeGesture {
  cancel: () => void;
  finish: (clientX: number) => void;
  move: (clientX: number) => void;
  start: (session: PointerResizeSession) => void;
}

export function createPointerResizeGesture(
  frames: AnimationFrameScheduler
): PointerResizeGesture {
  let frameId: number | null = null;
  let latestClientX: number | null = null;
  let session: PointerResizeSession | null = null;

  const clearPendingFrame = () => {
    if (frameId !== null) {
      frames.cancel(frameId);
      frameId = null;
    }
  };

  const flushPreview = () => {
    frameId = null;
    const clientX = latestClientX;
    latestClientX = null;
    if (session && clientX !== null) {
      session.preview(clientX);
    }
  };

  const cancel = () => {
    clearPendingFrame();
    latestClientX = null;
    const activeSession = session;
    session = null;
    activeSession?.cancel?.();
  };

  return {
    cancel,
    finish(clientX) {
      if (!session) {
        return;
      }
      clearPendingFrame();
      latestClientX = null;
      const activeSession = session;
      session = null;
      activeSession.preview(clientX);
      activeSession.commit(clientX);
    },
    move(clientX) {
      if (!session) {
        return;
      }
      latestClientX = clientX;
      if (frameId === null) {
        frameId = frames.request(flushPreview);
      }
    },
    start(nextSession) {
      cancel();
      session = nextSession;
    },
  };
}

interface ActivePointer {
  bodyCursor: string;
  bodyUserSelect: string;
  pointerId: number;
  target: HTMLElement;
}

function browserAnimationFrames(): AnimationFrameScheduler {
  return {
    cancel: (id) => cancelAnimationFrame(id),
    request: (callback) => requestAnimationFrame(callback),
  };
}

function releasePointerCapture(activePointer: ActivePointer) {
  const { pointerId, target } = activePointer;
  if (target.hasPointerCapture?.(pointerId)) {
    target.releasePointerCapture(pointerId);
  }
}

export function usePointerResizeGesture(cursor = "col-resize") {
  const activePointerRef = useRef<ActivePointer | null>(null);
  const gestureRef = useRef<PointerResizeGesture | null>(null);

  const getGesture = useCallback(() => {
    gestureRef.current ??= createPointerResizeGesture(browserAnimationFrames());
    return gestureRef.current;
  }, []);

  const restorePointerEnvironment = useCallback(() => {
    const activePointer = activePointerRef.current;
    if (!activePointer) {
      return;
    }
    releasePointerCapture(activePointer);
    document.body.style.cursor = activePointer.bodyCursor;
    document.body.style.userSelect = activePointer.bodyUserSelect;
    activePointerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    gestureRef.current?.cancel();
    restorePointerEnvironment();
  }, [restorePointerEnvironment]);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(
    (event: ReactPointerEvent<HTMLElement>, session: PointerResizeSession) => {
      event.preventDefault();
      cancel();

      const target = event.currentTarget;
      target.setPointerCapture?.(event.pointerId);
      activePointerRef.current = {
        bodyCursor: document.body.style.cursor,
        bodyUserSelect: document.body.style.userSelect,
        pointerId: event.pointerId,
        target,
      };
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
      getGesture().start(session);
    },
    [cancel, cursor, getGesture]
  );

  const move = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (activePointerRef.current?.pointerId === event.pointerId) {
      gestureRef.current?.move(event.clientX);
    }
  }, []);

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (activePointerRef.current?.pointerId !== event.pointerId) {
        return;
      }
      gestureRef.current?.finish(event.clientX);
      restorePointerEnvironment();
    },
    [restorePointerEnvironment]
  );

  const handleCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (activePointerRef.current?.pointerId === event.pointerId) {
        cancel();
      }
    },
    [cancel]
  );

  return {
    cancel: handleCancel,
    finish,
    move,
    start,
  };
}
