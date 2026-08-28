CREATE SCHEMA "sealai_notification";
--> statement-breakpoint
CREATE TABLE "sealai_notification"."notification_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"user_uid" text,
	"kind" text NOT NULL,
	"project_uid" text,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealai_notification"."notification_read_receipts" (
	"user_uid" text NOT NULL,
	"message_key" text NOT NULL,
	"message_id" text,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_read_receipts_user_uid_message_key_pk" PRIMARY KEY("user_uid","message_key")
);
--> statement-breakpoint
ALTER TABLE "sealai_notification"."notification_read_receipts" ADD CONSTRAINT "notification_read_receipts_message_id_notification_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "sealai_notification"."notification_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_messages_live_dedupe_key_idx" ON "sealai_notification"."notification_messages" USING btree ("dedupe_key") WHERE "sealai_notification"."notification_messages"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notification_messages_namespace_created_at_idx" ON "sealai_notification"."notification_messages" USING btree ("namespace","created_at");--> statement-breakpoint
CREATE INDEX "notification_messages_user_uid_created_at_idx" ON "sealai_notification"."notification_messages" USING btree ("user_uid","created_at");--> statement-breakpoint
CREATE INDEX "notification_messages_created_at_idx" ON "sealai_notification"."notification_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_read_receipts_message_id_idx" ON "sealai_notification"."notification_read_receipts" USING btree ("message_id");