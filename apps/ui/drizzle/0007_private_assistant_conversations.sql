DELETE FROM "sealai_assistant"."assistant_chats";--> statement-breakpoint
DROP INDEX "sealai_assistant"."assistant_chats_namespace_user_updated_at_idx";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."assistant_chats" RENAME COLUMN "user_id" TO "workspace_actor";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."assistant_chats" ALTER COLUMN "workspace_actor" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "assistant_chats_namespace_actor_updated_at_idx" ON "sealai_assistant"."assistant_chats" USING btree ("namespace","workspace_actor","updated_at");
