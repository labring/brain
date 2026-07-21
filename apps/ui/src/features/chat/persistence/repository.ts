import "server-only";

import { getAssistantDb } from "./db";
import { createAssistantConversationRepository } from "./repository-core";

export type {
  AssistantConversationRepository,
  ThreadRow,
} from "./repository-core";

export const assistantConversationRepository =
  createAssistantConversationRepository(getAssistantDb);
