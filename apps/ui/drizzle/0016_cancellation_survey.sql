CREATE SCHEMA "sealai_cancellation_survey";
--> statement-breakpoint
CREATE TABLE "sealai_cancellation_survey"."cancellation_survey_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"region_domain" text NOT NULL,
	"plan_name" text NOT NULL,
	"current_period_end_at" timestamp with time zone,
	"user_uid" text NOT NULL,
	"reason_keys" jsonb NOT NULL,
	"feedback" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
