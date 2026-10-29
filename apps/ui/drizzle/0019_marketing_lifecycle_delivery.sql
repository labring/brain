ALTER TABLE "sealai_marketing"."lifecycle_events" ADD COLUMN "forwarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sealai_marketing"."lifecycle_events" ADD COLUMN "forward_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_marketing"."lifecycle_events" ADD COLUMN "next_forward_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sealai_marketing"."lifecycle_events" ADD COLUMN "last_forward_error" text;--> statement-breakpoint
CREATE INDEX "lifecycle_events_forward_pending_idx" ON "sealai_marketing"."lifecycle_events" USING btree ("next_forward_at") WHERE "sealai_marketing"."lifecycle_events"."forwarded_at" IS NULL AND "sealai_marketing"."lifecycle_events"."forward_attempts" < 10;
--> statement-breakpoint
-- Historical facts remain inspectable but are not automatically replayed.
UPDATE "sealai_marketing"."lifecycle_events"
SET "forward_attempts" = 10, "last_forward_error" = 'historical_not_scheduled';
