import type { UIMessage } from "ai";

/** Deterministic mock conversation for the AI Elements registry preview. */
export const MOCK_MESSAGES: UIMessage[] = [
  {
    id: "m1",
    role: "user",
    parts: [
      { type: "text", text: "How do I expose my app on a custom domain?" },
    ],
  },
  {
    id: "m2",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "You can attach a custom domain in three steps:\n\n1. Add the domain under **Networking → Domains**.\n2. Point a `CNAME` record at the generated target.\n3. Wait for the TLS certificate to be issued.\n\nOnce the certificate is **Ready**, traffic resolves automatically.",
      },
    ],
  },
  {
    id: "m3",
    role: "user",
    parts: [{ type: "text", text: "What if the certificate stays pending?" }],
  },
  {
    id: "m4",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "A pending certificate almost always means the `CNAME` has not propagated yet. Verify it with:\n\n```bash\ndig +short CNAME app.example.com\n```\n\nIf the target does not match, fix the DNS record and re-check in a few minutes.",
      },
    ],
  },
];
