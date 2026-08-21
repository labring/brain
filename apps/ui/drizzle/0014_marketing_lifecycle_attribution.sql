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
	"ad_personalization" text DEFAULT 'unspecified' NOT NULL,
	"ad_user_data_consent" text DEFAULT 'unspecified' NOT NULL,
	"click_id_candidates" jsonb,
	"consent_provenance" jsonb,
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
	"ad_personalization" text DEFAULT 'unspecified' NOT NULL,
	"ad_user_data_consent" text DEFAULT 'unspecified' NOT NULL,
	"click_id_candidates" jsonb,
	"consent_provenance" jsonb,
	"hashed_user_data" jsonb,
	"transaction_id" text,
	"currency" text,
	"value" numeric(24, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sealai_deployment"."deploy_tasks" ADD COLUMN "marketing_attribution" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_events_action_transaction_idx" ON "sealai_marketing"."lifecycle_events" USING btree ("event_name","transaction_id") WHERE "sealai_marketing"."lifecycle_events"."transaction_id" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION "sealai_marketing"."attribution_user_id"(
	"p_attribution" jsonb
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT nullif(btrim("p_attribution" -> 'consent_provenance' ->> 'subject_id'), '');
$$;
--> statement-breakpoint
CREATE FUNCTION "sealai_marketing"."normalize_consent_state"(
	"p_value" jsonb
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT CASE jsonb_typeof("p_value")
		WHEN 'boolean' THEN CASE
			WHEN ("p_value" #>> '{}')::boolean THEN 'granted'
			ELSE 'denied'
		END
		WHEN 'string' THEN CASE lower("p_value" #>> '{}')
			WHEN 'granted' THEN 'granted'
			WHEN 'denied' THEN 'denied'
			ELSE 'unspecified'
		END
		ELSE 'unspecified'
	END;
$$;
--> statement-breakpoint
CREATE FUNCTION "sealai_marketing"."upsert_attribution_subject"(
	"p_subject_type" text,
	"p_subject_id" text,
	"p_attribution" jsonb,
	-- Missing-only mode creates a row when none exists and never touches an
	-- existing one: repair paths replay historical snapshots, which must not
	-- overwrite consent a subject has changed since.
	"p_missing_only" boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	v_ad_personalization text;
	v_ad_user_data_consent text;
BEGIN
	IF p_subject_id IS NULL OR btrim(p_subject_id) = '' OR p_attribution IS NULL THEN
		RETURN;
	END IF;

	v_ad_user_data_consent := "sealai_marketing"."normalize_consent_state"(
		p_attribution -> 'ad_user_data_consent'
	);
	v_ad_personalization := "sealai_marketing"."normalize_consent_state"(
		p_attribution -> 'ad_personalization'
	);

	IF p_missing_only THEN
		INSERT INTO "sealai_marketing"."attribution_subjects" (
			"subject_type",
			"subject_id",
			"first_touch",
			"last_touch",
			"gclid",
			"gbraid",
			"wbraid",
			"ad_personalization",
			"ad_user_data_consent",
			"click_id_candidates",
			"consent_provenance"
		) VALUES (
			p_subject_type,
			p_subject_id,
			p_attribution -> 'first_touch',
			p_attribution -> 'last_touch',
			nullif(p_attribution ->> 'gclid', ''),
			nullif(p_attribution ->> 'gbraid', ''),
			nullif(p_attribution ->> 'wbraid', ''),
			v_ad_personalization,
			v_ad_user_data_consent,
			p_attribution -> 'click_id_candidates',
			p_attribution -> 'consent_provenance'
		)
		ON CONFLICT ("subject_type", "subject_id") DO NOTHING;
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
		"ad_personalization",
		"ad_user_data_consent",
		"click_id_candidates",
		"consent_provenance"
	) VALUES (
		p_subject_type,
		p_subject_id,
		p_attribution -> 'first_touch',
		p_attribution -> 'last_touch',
		nullif(p_attribution ->> 'gclid', ''),
		nullif(p_attribution ->> 'gbraid', ''),
		nullif(p_attribution ->> 'wbraid', ''),
		v_ad_personalization,
		v_ad_user_data_consent,
		p_attribution -> 'click_id_candidates',
		p_attribution -> 'consent_provenance'
	)
	ON CONFLICT ("subject_type", "subject_id") DO UPDATE SET
		"first_touch" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce("attribution_subjects"."first_touch", EXCLUDED."first_touch")
			WHEN EXCLUDED."ad_user_data_consent" = 'denied'
				THEN EXCLUDED."first_touch"
			ELSE "attribution_subjects"."first_touch"
		END,
		"last_touch" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce(EXCLUDED."last_touch", "attribution_subjects"."last_touch")
			WHEN EXCLUDED."ad_user_data_consent" = 'denied'
				THEN EXCLUDED."last_touch"
			ELSE "attribution_subjects"."last_touch"
		END,
		"gclid" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce(EXCLUDED."gclid", "attribution_subjects"."gclid")
			WHEN EXCLUDED."ad_user_data_consent" = 'denied' THEN NULL
			ELSE "attribution_subjects"."gclid"
		END,
		"gbraid" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce(EXCLUDED."gbraid", "attribution_subjects"."gbraid")
			WHEN EXCLUDED."ad_user_data_consent" = 'denied' THEN NULL
			ELSE "attribution_subjects"."gbraid"
		END,
		"wbraid" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce(EXCLUDED."wbraid", "attribution_subjects"."wbraid")
			WHEN EXCLUDED."ad_user_data_consent" = 'denied' THEN NULL
			ELSE "attribution_subjects"."wbraid"
		END,
		"ad_personalization" = CASE
			WHEN EXCLUDED."ad_personalization" = 'unspecified'
				THEN "attribution_subjects"."ad_personalization"
			ELSE EXCLUDED."ad_personalization"
		END,
		"ad_user_data_consent" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'unspecified'
				THEN "attribution_subjects"."ad_user_data_consent"
			ELSE EXCLUDED."ad_user_data_consent"
		END,
		"click_id_candidates" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'granted'
				THEN coalesce(EXCLUDED."click_id_candidates", "attribution_subjects"."click_id_candidates")
			WHEN EXCLUDED."ad_user_data_consent" = 'denied'
				THEN EXCLUDED."click_id_candidates"
			ELSE "attribution_subjects"."click_id_candidates"
		END,
		"consent_provenance" = CASE
			WHEN EXCLUDED."ad_user_data_consent" = 'unspecified'
				AND EXCLUDED."consent_provenance" IS NULL
				THEN "attribution_subjects"."consent_provenance"
			ELSE EXCLUDED."consent_provenance"
		END,
		"updated_at" = now();
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "sealai_marketing"."capture_deploy_attribution"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM "sealai_marketing"."upsert_attribution_subject"(
		'user', "sealai_marketing"."attribution_user_id"(
			NEW."marketing_attribution"
		), NEW."marketing_attribution"
	);
	PERFORM "sealai_marketing"."upsert_attribution_subject"(
		'workspace', NEW."namespace", NEW."marketing_attribution"
	);
	RETURN NEW;
EXCEPTION WHEN OTHERS THEN
	RAISE WARNING '[marketing] attribution capture failed for deploy task %: %', NEW."id", SQLERRM;
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
	"v_user_id" text;
	"v_ad_personalization" text;
	"v_ad_user_data_consent" text;
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
	"v_user_id" := "sealai_marketing"."attribution_user_id"(
		NEW."marketing_attribution"
	);

	"v_ad_user_data_consent" := "sealai_marketing"."normalize_consent_state"(
		NEW."marketing_attribution" -> 'ad_user_data_consent'
	);
	"v_ad_personalization" := "sealai_marketing"."normalize_consent_state"(
		NEW."marketing_attribution" -> 'ad_personalization'
	);

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
		"ad_personalization",
		"ad_user_data_consent",
		"click_id_candidates",
		"consent_provenance"
	) VALUES (
		v_event_name || ':' || NEW."id",
		v_event_name,
		"v_user_id",
		NEW."namespace",
		NEW."id",
		v_occurred_at,
		NEW."marketing_attribution" -> 'first_touch',
		NEW."marketing_attribution" -> 'last_touch',
		nullif(NEW."marketing_attribution" ->> 'gclid', ''),
		nullif(NEW."marketing_attribution" ->> 'gbraid', ''),
		nullif(NEW."marketing_attribution" ->> 'wbraid', ''),
		"v_ad_personalization",
		"v_ad_user_data_consent",
		NEW."marketing_attribution" -> 'click_id_candidates',
		NEW."marketing_attribution" -> 'consent_provenance'
	)
	ON CONFLICT ("event_id") DO NOTHING;

	RETURN NEW;
EXCEPTION WHEN OTHERS THEN
	RAISE WARNING '[marketing] lifecycle enqueue failed for deploy task %: %', NEW."id", SQLERRM;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "deploy_tasks_enqueue_lifecycle_event"
AFTER UPDATE OF "status" ON "sealai_deployment"."deploy_tasks"
FOR EACH ROW EXECUTE FUNCTION "sealai_marketing"."enqueue_deploy_lifecycle_event"();
--> statement-breakpoint
CREATE FUNCTION "sealai_marketing"."reconcile_deploy_marketing_attribution"(
	"p_limit" integer DEFAULT 100
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
	"v_task" record;
	"v_repaired" integer := 0;
	"v_user_id" text;
	"v_ad_personalization" text;
	"v_ad_user_data_consent" text;
BEGIN
	FOR "v_task" IN
		-- Only tasks with a dropped lifecycle event qualify: repaired rows
		-- leave this scan, so successive limited runs make progress instead
		-- of replaying the same oldest rows forever.
		SELECT *
		FROM "sealai_deployment"."deploy_tasks" "t"
		WHERE "t"."marketing_attribution" IS NOT NULL
			AND "t"."status" IN ('running', 'completed')
			AND (
				NOT EXISTS (
					SELECT 1 FROM "sealai_marketing"."lifecycle_events" "e"
					WHERE "e"."event_id" = 'build_started:' || "t"."id"
				)
				OR (
					"t"."status" = 'completed'
					AND NOT EXISTS (
						SELECT 1 FROM "sealai_marketing"."lifecycle_events" "e"
						WHERE "e"."event_id" = 'deploy_success:' || "t"."id"
					)
				)
			)
		ORDER BY "t"."updated_at"
		LIMIT greatest(coalesce("p_limit", 100), 0)
	LOOP
		BEGIN
			"v_user_id" := "sealai_marketing"."attribution_user_id"(
				"v_task"."marketing_attribution"
			);
			"v_ad_user_data_consent" := "sealai_marketing"."normalize_consent_state"(
				"v_task"."marketing_attribution" -> 'ad_user_data_consent'
			);
			"v_ad_personalization" := "sealai_marketing"."normalize_consent_state"(
				"v_task"."marketing_attribution" -> 'ad_personalization'
			);
			-- Missing-only: the task snapshot is historical, so it may create a
			-- subject row the capture trigger dropped but never overwrite consent
			-- the subject has changed since.
			PERFORM "sealai_marketing"."upsert_attribution_subject"(
				'user', "v_user_id", "v_task"."marketing_attribution", true
			);
			PERFORM "sealai_marketing"."upsert_attribution_subject"(
				'workspace', "v_task"."namespace", "v_task"."marketing_attribution", true
			);

			INSERT INTO "sealai_marketing"."lifecycle_events" (
				"event_id", "event_name", "user_id", "workspace_id", "deployment_id",
				"occurred_at", "first_touch", "last_touch", "gclid", "gbraid", "wbraid",
				"ad_personalization", "ad_user_data_consent", "click_id_candidates", "consent_provenance"
			) VALUES (
				'build_started:' || "v_task"."id", 'build_started', "v_user_id",
				"v_task"."namespace", "v_task"."id", coalesce("v_task"."started_at", "v_task"."created_at"),
				"v_task"."marketing_attribution" -> 'first_touch',
				"v_task"."marketing_attribution" -> 'last_touch',
				nullif("v_task"."marketing_attribution" ->> 'gclid', ''),
				nullif("v_task"."marketing_attribution" ->> 'gbraid', ''),
				nullif("v_task"."marketing_attribution" ->> 'wbraid', ''),
				"v_ad_personalization",
				"v_ad_user_data_consent",
				"v_task"."marketing_attribution" -> 'click_id_candidates',
				"v_task"."marketing_attribution" -> 'consent_provenance'
			)
			ON CONFLICT ("event_id") DO NOTHING;

			IF "v_task"."status" = 'completed' THEN
				INSERT INTO "sealai_marketing"."lifecycle_events" (
					"event_id", "event_name", "user_id", "workspace_id", "deployment_id",
					"occurred_at", "first_touch", "last_touch", "gclid", "gbraid", "wbraid",
					"ad_personalization", "ad_user_data_consent", "click_id_candidates", "consent_provenance"
				) VALUES (
					'deploy_success:' || "v_task"."id", 'deploy_success', "v_user_id",
					"v_task"."namespace", "v_task"."id", coalesce("v_task"."completed_at", "v_task"."updated_at"),
					"v_task"."marketing_attribution" -> 'first_touch',
					"v_task"."marketing_attribution" -> 'last_touch',
					nullif("v_task"."marketing_attribution" ->> 'gclid', ''),
					nullif("v_task"."marketing_attribution" ->> 'gbraid', ''),
					nullif("v_task"."marketing_attribution" ->> 'wbraid', ''),
					"v_ad_personalization",
					"v_ad_user_data_consent",
					"v_task"."marketing_attribution" -> 'click_id_candidates',
					"v_task"."marketing_attribution" -> 'consent_provenance'
				)
				ON CONFLICT ("event_id") DO NOTHING;
			END IF;
			"v_repaired" := "v_repaired" + 1;
		EXCEPTION WHEN OTHERS THEN
			RAISE WARNING '[marketing] reconciliation failed for deploy task %: %', "v_task"."id", SQLERRM;
		END;
	END LOOP;
	RETURN "v_repaired";
END;
$$;
--> statement-breakpoint
CREATE TABLE "sealai_assistant"."identity_uid_canonicalizations" (
	"user_uid" text PRIMARY KEY NOT NULL,
	"canonical_user_uid" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "identity_uid_canonicalizations_canonical_idx" ON "sealai_assistant"."identity_uid_canonicalizations" USING btree ("canonical_user_uid");
