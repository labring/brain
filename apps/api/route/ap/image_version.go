package ap

import (
	"context"
	"encoding/json"
	"errors"

	"sealos/api/service/apversion"
)

type apImageVersionRecorder func(context.Context, map[string]interface{}, string) (*apversion.Version, error)

func recordAPImageVersionSideEffect(ctx context.Context, body json.RawMessage, source string, recorder apImageVersionRecorder) (json.RawMessage, error) {
	var ap map[string]interface{}
	if err := json.Unmarshal(body, &ap); err != nil {
		return nil, err
	}
	if _, err := recorder(ctx, ap, source); err != nil {
		return appendAPImageVersionWarning(ap, err)
	}
	return body, nil
}

func appendAPImageVersionWarning(ap map[string]interface{}, recordErr error) (json.RawMessage, error) {
	message := "AP image history could not be recorded"
	if errors.Is(recordErr, apversion.ErrDatabaseNotConfigured) {
		message = "AP image history storage is not configured"
	}
	metadata, _ := ap["metadata"].(map[string]interface{})
	if metadata == nil {
		metadata = map[string]interface{}{}
		ap["metadata"] = metadata
	}
	warnings, _ := metadata["warnings"].([]interface{})
	metadata["warnings"] = append(warnings, map[string]interface{}{
		"code":    "ap-image-history-unavailable",
		"message": message,
	})
	return json.Marshal(ap)
}

func recordAPImageVersion(ctx context.Context, ap map[string]interface{}, source string) (*apversion.Version, error) {
	store, err := apversion.DefaultStore(ctx)
	if err != nil {
		return nil, err
	}
	meta, _ := ap["metadata"].(map[string]interface{})
	spec, _ := ap["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	return store.Record(ctx, apversion.RecordInput{
		Namespace:       stringFromMap(meta, "namespace"),
		APName:          stringFromMap(meta, "name"),
		Image:           stringFromMap(input, "image"),
		ImagePullPolicy: stringFromMap(input, "imagePullPolicy"),
		Source:          source,
		SpecSnapshot:    spec,
	})
}
