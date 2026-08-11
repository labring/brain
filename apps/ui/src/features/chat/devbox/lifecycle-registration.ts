import "server-only";

import { recordChatDevboxActivity as recordLifecycleActivity } from "./lifecycle";

export async function recordChatDevboxActivity(
  input: {
    namespace: string;
    pauseDueAt: Date;
    runtimeName: string;
    upstreamId: string;
  },
  signal?: AbortSignal
): Promise<void> {
  await recordLifecycleActivity(input, undefined, signal);
}
