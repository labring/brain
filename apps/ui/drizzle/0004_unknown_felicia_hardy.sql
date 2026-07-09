DROP INDEX "sealai_assistant"."assistant_chats_namespace_updated_at_idx";--> statement-breakpoint
ALTER TABLE "sealai_assistant"."assistant_chats" ADD COLUMN "user_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_chats_namespace_user_updated_at_idx" ON "sealai_assistant"."assistant_chats" USING btree ("namespace","user_id","updated_at");