CREATE OR REPLACE FUNCTION "sealai_marketing"."capture_deploy_attribution"() RETURNS trigger
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
CREATE OR REPLACE FUNCTION "sealai_marketing"."enqueue_deploy_lifecycle_event"() RETURNS trigger
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
		"event_id", "event_name", "user_id", "workspace_id", "deployment_id",
		"occurred_at", "first_touch", "last_touch", "gclid", "gbraid", "wbraid",
		"ad_personalization", "ad_user_data_consent", "click_id_candidates", "consent_provenance"
	) VALUES (
		v_event_name || ':' || NEW."id", v_event_name, "v_user_id", NEW."namespace", NEW."id",
		v_occurred_at, NEW."marketing_attribution" -> 'first_touch',
		NEW."marketing_attribution" -> 'last_touch',
		nullif(NEW."marketing_attribution" ->> 'gclid', ''),
		nullif(NEW."marketing_attribution" ->> 'gbraid', ''),
		nullif(NEW."marketing_attribution" ->> 'wbraid', ''),
		v_ad_personalization, v_ad_user_data_consent,
		NEW."marketing_attribution" -> 'click_id_candidates',
		NEW."marketing_attribution" -> 'consent_provenance'
	)
	ON CONFLICT ("event_id") DO NOTHING;

	RETURN NEW;
END;
$$;
