/**
 * Execute all chat tools directly by default, including newly registered tools.
 * New user turns cancel pending approvals left in older conversation history.
 */
export const CHAT_TOOL_APPROVAL = () => "not-applicable" as const;
