import { expect, mock, test } from "bun:test";

const messagesGet = () => Promise.resolve(Response.json({ messages: [] }));

mock.module("server-only", () => ({}));
mock.module("@/features/chat/runtime/conversation-route-handlers", () => ({
  assistantConversationRouteHandlers: { messagesGet },
}));

const route = await import("./route");

test("messages route remains read-only", async () => {
  expect(route.GET).toBe(messagesGet);
  expect("POST" in route).toBe(false);
  expect((await route.GET(new Request("https://brain.test"))).status).toBe(200);
});
