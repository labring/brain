CREATE SCHEMA "sealai_marketing";
--> statement-breakpoint
CREATE TABLE "sealai_marketing"."attribution_subjects" (
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"first_touch" jsonb,
	"last_touch" jsonb,
	"gclid" text,
	"gbraid" text,
	"wbraid" text,
	"ad_user_data_consent" text DEFAULT 'denied' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribution_subjects_pk" PRIMARY KEY("subject_type","subject_id")
);
--> statement-breakpoint
CREATE TABLE "sealai_marketing"."lifecycle_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"deployment_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"first_touch" jsonb,
	"last_touch" jsonb,
	"gclid" text,
	"gbraid" text,
	"wbraid" text,
	"ad_user_data_consent" text DEFAULT 'denied' NOT NULL,
	"hashed_user_data" jsonb,
	"transaction_id" text,
	"currency" text,
	"value" numeric(24, 6),
	"status" text DEFAULT 'pending' NOT NULL,
	"upload_error" text,
	"upload_request_id" text,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "marketing_attribution" jsonb;--> statement-breakpoint
CREATE INDEX "attribution_subjects_updated_at_idx" ON "sealai_marketing"."attribution_subjects" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "lifecycle_events_pending_idx" ON "sealai_marketing"."lifecycle_events" USING btree ("occurred_at") WHERE "sealai_marketing"."lifecycle_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "lifecycle_events_workspace_idx" ON "sealai_marketing"."lifecycle_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lifecycle_events_deployment_idx" ON "sealai_marketing"."lifecycle_events" USING btree ("deployment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_events_payment_transaction_idx" ON "sealai_marketing"."lifecycle_events" USING btree ("transaction_id") WHERE "sealai_marketing"."lifecycle_events"."transaction_id" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION "sealai_marketing"."upsert_attribution_subject"(
	"p_subject_type" text,
	"p_subject_id" text,
	"p_attribution" jsonb
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
	IF p_subject_id IS NULL OR btrim(p_subject_id) = '' OR p_attribution IS NULL THEN
		RETURN;
	END IF;

	INSERT INTO "sealai_marketing"."attribution_subjects" (
		"subject_type",
		"subject_id",
		"first_touch",
		"last_touch",
		"gclid",
		"gbraid",
		"wbraid",
		"ad_user_data_consent"
	) VALUES (
		p_subject_type,
		p_subject_id,
		p_attribution -> 'first_touch',
		p_attribution -> 'last_touch',
		nullif(p_attribution ->> 'gclid', ''),
		nullif(p_attribution ->> 'gbraid', ''),
		nullif(p_attribution ->> 'wbraid', ''),
		CASE
			WHEN coalesce((p_attribution ->> 'ad_user_data_consent')::boolean, false)
				THEN 'granted'
			ELSE 'denied'
		END
	)
	ON CONFLICT ("subject_type", "subject_id") DO UPDATE SET
		"first_touch" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce("attribution_subjects"."first_touch", EXCLUDED."first_touch")
			ELSE EXCLUDED."first_touch"
		END,
		"last_touch" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce(EXCLUDED."last_touch", "attribution_subjects"."last_touch")
			ELSE NULL
		END,
		"gclid" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce(EXCLUDED."gclid", "attribution_subjects"."gclid")
			ELSE NULL
		END,
		"gbraid" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce(EXCLUDED."gbraid", "attribution_subjects"."gbraid")
			ELSE NULL
		END,
		"wbraid" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce(EXCLUDED."wbraid", "attribution_subjects"."wbraid")
			ELSE NULL
		END,
		"ad_user_data_consent" = EXCLUDED."ad_user_data_consent",
		"updated_at" = now();
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "sealai_marketing"."capture_deploy_attribution"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM "sealai_marketing"."upsert_attribution_subject"(
		'user', NEW."creating_actor", NEW."marketing_attribution"
	);
	PERFORM "sealai_marketing"."upsert_attribution_subject"(
		'workspace', NEW."namespace", NEW."marketing_attribution"
	);
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "deploy_tasks_capture_attribution"
AFTER INSERT ON "sealai_deployment"."deploy_tasks"
FOR EACH ROW EXECUTE FUNCTION "sealai_marketing"."capture_deploy_attribution"();
--> statement-breakpoint
CREATE FUNCTION "sealai_marketing"."enqueue_deploy_lifecycle_event"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	"v_event_name" text;
	"v_occurred_at" timestamp with time zone;
BEGIN
	IF NEW."status" = 'running' AND OLD."status" IS DISTINCT FROM 'running' THEN
		v_event_name := 'build_started';
		v_occurred_at := coalesce(NEW."started_at", now());
	ELSIF NEW."status" = 'completed' AND OLD."status" IS DISTINCT FROM 'completed' THEN
		v_event_name := 'deploy_success';
		v_occurred_at := coalesce(NEW."completed_at", now());
	ELSE
		RETURN NEW;
	END IF;

	INSERT INTO "sealai_marketing"."lifecycle_events" (
		"event_id",
		"event_name",
		"user_id",
		"workspace_id",
		"deployment_id",
		"occurred_at",
		"first_touch",
		"last_touch",
		"gclid",
		"gbraid",
		"wbraid",
		"ad_user_data_consent"
	) VALUES (
		v_event_name || ':' || NEW."id",
		v_event_name,
		NEW."creating_actor",
		NEW."namespace",
		NEW."id",
		v_occurred_at,
		NEW."marketing_attribution" -> 'first_touch',
		NEW."marketing_attribution" -> 'last_touch',
		nullif(NEW."marketing_attribution" ->> 'gclid', ''),
		nullif(NEW."marketing_attribution" ->> 'gbraid', ''),
		nullif(NEW."marketing_attribution" ->> 'wbraid', ''),
		CASE
			WHEN coalesce((NEW."marketing_attribution" ->> 'ad_user_data_consent')::boolean, false)
				THEN 'granted'
			ELSE 'denied'
		END
	)
	ON CONFLICT ("event_id") DO NOTHING;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "deploy_tasks_enqueue_lifecycle_event"
AFTER UPDATE OF "status" ON "sealai_deployment"."deploy_tasks"
FOR EACH ROW EXECUTE FUNCTION "sealai_marketing"."enqueue_deploy_lifecycle_event"();
