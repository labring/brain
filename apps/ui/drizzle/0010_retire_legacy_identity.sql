DELETE FROM "sealai_assistant"."github_app_install_sessions";--> statement-breakpoint
DELETE FROM "sealai_assistant"."github_oauth_connections";--> statement-breakpoint
DELETE FROM "sealai_assistant"."github_connections";--> statement-breakpoint
DELETE FROM "sealai_assistant"."assistant_chat_messages";--> statement-breakpoint
DELETE FROM "sealai_assistant"."assistant_chats";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_app_install_sessions" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."github_oauth_connections" DROP COLUMN "user_id";
