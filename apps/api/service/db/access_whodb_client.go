package db

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
)

type WhoDBHTTPClient struct {
	baseURL string
	client  *http.Client
	timeout time.Duration
}

// WhoDBQueryError is a query-level database error surfaced by WhoDB as a
// GraphQL error: the access backend answered, but the database rejected the
// operation. It carries the database's own message so routes can put it in
// the response detail, keeping these failures distinct from transport-level
// unavailability (ErrAccessHealthWhoDBUnavailable).
type WhoDBQueryError struct {
	Message string
}

func (e *WhoDBQueryError) Error() string {
	return "db access query failed: " + e.Message
}

type whoDBObjectPayload struct {
	Ref struct {
		Kind string   `json:"Kind"`
		Path []string `json:"Path"`
	} `json:"Ref"`
	Kind        string `json:"Kind"`
	Name        string `json:"Name"`
	Path        []string
	HasChildren bool `json:"HasChildren"`
	Attributes  []struct {
		Key   string `json:"Key"`
		Value string `json:"Value"`
	} `json:"Metadata"`
}

func NewWhoDBHTTPClient(baseURL string, client *http.Client, timeout time.Duration) *WhoDBHTTPClient {
	if client == nil {
		client = http.DefaultClient
	}
	return &WhoDBHTTPClient{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		client:  client,
		timeout: timeout,
	}
}

func (c *WhoDBHTTPClient) CheckHealth(ctx context.Context, credentials WhoDBSourceCredentials) (*WhoDBHealth, error) {
	var out struct {
		Health WhoDBHealth `json:"Health"`
	}
	if err := c.query(ctx, credentials, "AccessHealth", "query AccessHealth { Health { Server Database } }", nil, &out); err != nil {
		return nil, err
	}
	return &out.Health, nil
}

func (c *WhoDBHTTPClient) ListObjects(ctx context.Context, credentials WhoDBSourceCredentials, parent *WhoDBObjectRef, kinds []string) ([]WhoDBObject, error) {
	var out struct {
		SourceObjects []whoDBObjectPayload `json:"SourceObjects"`
	}
	variables := map[string]any{}
	if parent != nil {
		variables["parent"] = map[string]any{
			"Kind": parent.Kind,
			"Path": parent.Path,
		}
	}
	if len(kinds) > 0 {
		variables["kinds"] = kinds
	}
	err := c.query(
		ctx,
		credentials,
		"AccessObjects",
		"query AccessObjects($parent: SourceObjectRefInput, $kinds: [SourceObjectKind!]) { SourceObjects(parent: $parent, kinds: $kinds) { Ref { Kind Path } Kind Name Path HasChildren Metadata { Key Value } } }",
		variables,
		&out,
	)
	if err != nil {
		return nil, err
	}

	objects := make([]WhoDBObject, 0, len(out.SourceObjects))
	for _, object := range out.SourceObjects {
		objects = append(objects, whoDBObjectFromPayload(object))
	}
	return objects, nil
}

func (c *WhoDBHTTPClient) GetObject(ctx context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef) (*WhoDBObject, error) {
	var out struct {
		SourceObject *whoDBObjectPayload `json:"SourceObject"`
	}
	err := c.query(
		ctx,
		credentials,
		"AccessObject",
		"query AccessObject($ref: SourceObjectRefInput!) { SourceObject(ref: $ref) { Ref { Kind Path } Kind Name Path HasChildren Metadata { Key Value } } }",
		map[string]any{"ref": whoDBObjectRefVariable(ref)},
		&out,
	)
	if err != nil {
		return nil, err
	}
	if out.SourceObject == nil {
		return nil, nil
	}
	object := whoDBObjectFromPayload(*out.SourceObject)
	return &object, nil
}

func (c *WhoDBHTTPClient) ListColumns(ctx context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef) ([]WhoDBColumn, error) {
	var out struct {
		SourceColumns []WhoDBColumn `json:"SourceColumns"`
	}
	err := c.query(
		ctx,
		credentials,
		"AccessColumns",
		"query AccessColumns($ref: SourceObjectRefInput!) { SourceColumns(ref: $ref) { Name Type IsPrimary IsForeignKey ReferencedTable ReferencedColumn Length Precision Scale } }",
		map[string]any{"ref": whoDBObjectRefVariable(ref)},
		&out,
	)
	if err != nil {
		return nil, err
	}
	return out.SourceColumns, nil
}

func (c *WhoDBHTTPClient) ReadRows(ctx context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef, pageSize int, pageOffset int, sort []WhoDBRowsSort) (*WhoDBRowsResult, error) {
	var out struct {
		SourceRows WhoDBRowsResult `json:"SourceRows"`
	}
	variables := map[string]any{
		"ref":        whoDBObjectRefVariable(ref),
		"pageSize":   pageSize,
		"pageOffset": pageOffset,
	}
	if len(sort) > 0 {
		variables["sort"] = whoDBRowsSortVariables(sort)
	}
	err := c.query(
		ctx,
		credentials,
		"AccessRows",
		"query AccessRows($ref: SourceObjectRefInput!, $sort: [SortCondition!], $pageSize: Int!, $pageOffset: Int!) { SourceRows(ref: $ref, sort: $sort, pageSize: $pageSize, pageOffset: $pageOffset) { Columns { Name Type IsPrimary IsForeignKey ReferencedTable ReferencedColumn Length Precision Scale } Rows DisableUpdate TotalCount } }",
		variables,
		&out,
	)
	if err != nil {
		return nil, err
	}
	return &out.SourceRows, nil
}

func (c *WhoDBHTTPClient) Export(ctx context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef, format string) (*WhoDBExportResult, error) {
	if c == nil || c.baseURL == "" {
		return nil, ErrAccessHealthWhoDBMissing
	}
	if c.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.timeout)
		defer cancel()
	}

	body := map[string]any{
		"ref":    whoDBObjectRefVariable(ref),
		"format": format,
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	tokenBytes, err := json.Marshal(credentials)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/export", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+base64.StdEncoding.EncodeToString(tokenBytes))

	resp, err := c.client.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(ctx.Err(), context.Canceled) {
			return nil, fmt.Errorf("%w: %v", ErrAccessHealthWhoDBTimeout, err)
		}
		return nil, fmt.Errorf("%w: %v", ErrAccessHealthWhoDBUnavailable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusInternalServerError {
		return nil, fmt.Errorf("%w: status %d", ErrAccessHealthWhoDBUnavailable, resp.StatusCode)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("%w: status %d", ErrAccessHealthWhoDBUnavailable, resp.StatusCode)
	}

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrAccessHealthWhoDBUnavailable, err)
	}
	return &WhoDBExportResult{
		ContentType: resp.Header.Get("Content-Type"),
		Filename:    exportFilenameFromContentDisposition(resp.Header.Get("Content-Disposition")),
		Body:        responseBody,
	}, nil
}

func whoDBObjectFromPayload(object whoDBObjectPayload) WhoDBObject {
	metadata := make(map[string]string, len(object.Attributes))
	for _, attribute := range object.Attributes {
		metadata[attribute.Key] = attribute.Value
	}
	return WhoDBObject{
		Ref: WhoDBObjectRef{
			Kind: object.Ref.Kind,
			Path: object.Ref.Path,
		},
		Kind:        object.Kind,
		Name:        object.Name,
		Path:        object.Path,
		HasChildren: object.HasChildren,
		Metadata:    metadata,
	}
}

func exportFilenameFromContentDisposition(header string) string {
	_, params, err := mime.ParseMediaType(header)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(params["filename"])
}

func whoDBObjectRefVariable(ref WhoDBObjectRef) map[string]any {
	return map[string]any{
		"Kind": ref.Kind,
		"Path": ref.Path,
	}
}

func whoDBRowsSortVariables(sort []WhoDBRowsSort) []map[string]any {
	variables := make([]map[string]any, 0, len(sort))
	for _, item := range sort {
		variables = append(variables, map[string]any{
			"Column":    item.Column,
			"Direction": item.Direction,
		})
	}
	return variables
}

func (c *WhoDBHTTPClient) query(ctx context.Context, credentials WhoDBSourceCredentials, operationName, query string, variables map[string]any, out any) error {
	if c == nil || c.baseURL == "" {
		return ErrAccessHealthWhoDBMissing
	}
	if c.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.timeout)
		defer cancel()
	}
	if variables == nil {
		variables = map[string]any{}
	}

	body := map[string]any{
		"operationName": operationName,
		"query":         query,
		"variables":     variables,
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return err
	}
	tokenBytes, err := json.Marshal(credentials)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/query", bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+base64.StdEncoding.EncodeToString(tokenBytes))

	resp, err := c.client.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(ctx.Err(), context.Canceled) {
			return fmt.Errorf("%w: %v", ErrAccessHealthWhoDBTimeout, err)
		}
		return fmt.Errorf("%w: %v", ErrAccessHealthWhoDBUnavailable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusInternalServerError {
		return fmt.Errorf("%w: status %d", ErrAccessHealthWhoDBUnavailable, resp.StatusCode)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("%w: status %d", ErrAccessHealthWhoDBUnavailable, resp.StatusCode)
	}

	var response struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return fmt.Errorf("%w: %v", ErrAccessHealthWhoDBUnavailable, err)
	}
	if len(response.Errors) > 0 {
		message := response.Errors[0].Message
		if isWhoDBObjectNotFound(message) {
			return fmt.Errorf("%w: %s", ErrAccessObjectsNotFound, message)
		}
		return &WhoDBQueryError{Message: message}
	}
	if out != nil {
		if err := json.Unmarshal(response.Data, out); err != nil {
			return fmt.Errorf("%w: %v", ErrAccessHealthWhoDBUnavailable, err)
		}
	}
	return nil
}

func isWhoDBObjectNotFound(message string) bool {
	message = strings.ToLower(strings.TrimSpace(message))
	return strings.Contains(message, "source object") && strings.Contains(message, "not found")
}
