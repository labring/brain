package db

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWhoDBHTTPClientChecksHealthWithBearerSourceCredentials(t *testing.T) {
	var gotAuth string
	var gotBody struct {
		OperationName string         `json:"operationName"`
		Query         string         `json:"query"`
		Variables     map[string]any `json:"variables"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/query" {
			t.Fatalf("unexpected WhoDB request target: %s %s", r.Method, r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("failed to decode WhoDB request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"Health":{"Server":"healthy","Database":"healthy"}}}`))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	health, err := client.CheckHealth(context.Background(), WhoDBSourceCredentials{
		SourceType: "Postgres",
		Values: map[string]string{
			"Hostname": "pg-main-postgresql.ns-a.svc",
			"Port":     "5432",
			"Username": "alice",
			"Password": "s3cr3t",
			"Database": "postgres",
		},
	})
	if err != nil {
		t.Fatalf("expected WhoDB health check to succeed: %v", err)
	}
	if health.Server != "healthy" || health.Database != "healthy" {
		t.Fatalf("unexpected health: %+v", health)
	}
	if gotBody.OperationName != "AccessHealth" || !strings.Contains(gotBody.Query, "Health") {
		t.Fatalf("unexpected GraphQL request body: %+v", gotBody)
	}
	if gotAuth == "" || !strings.HasPrefix(gotAuth, "Bearer ") {
		t.Fatalf("expected bearer credentials, got %q", gotAuth)
	}
	rawToken := strings.TrimPrefix(gotAuth, "Bearer ")
	rawCredentials, err := base64.StdEncoding.DecodeString(rawToken)
	if err != nil {
		t.Fatalf("expected base64 bearer credentials: %v", err)
	}
	var gotCredentials WhoDBSourceCredentials
	if err := json.Unmarshal(rawCredentials, &gotCredentials); err != nil {
		t.Fatalf("expected source credentials JSON: %v", err)
	}
	if gotCredentials.SourceType != "Postgres" || gotCredentials.Values["Password"] != "s3cr3t" {
		t.Fatalf("unexpected bearer credentials: %+v", gotCredentials)
	}
}

func TestWhoDBHTTPClientListsSourceObjectsWithBearerSourceCredentials(t *testing.T) {
	var gotAuth string
	var gotBody struct {
		OperationName string         `json:"operationName"`
		Query         string         `json:"query"`
		Variables     map[string]any `json:"variables"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/query" {
			t.Fatalf("unexpected WhoDB request target: %s %s", r.Method, r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("failed to decode WhoDB request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"SourceObjects":[{"Ref":{"Kind":"Database","Path":["postgres"]},"Kind":"Database","Name":"postgres","Path":["postgres"],"HasChildren":true,"Metadata":[]}]}}`))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	objects, err := client.ListObjects(context.Background(), WhoDBSourceCredentials{
		SourceType: "Postgres",
		Values: map[string]string{
			"Hostname": "pg-main-postgresql.ns-a.svc",
			"Port":     "5432",
			"Username": "alice",
			"Password": "s3cr3t",
			"Database": "postgres",
		},
	}, nil, nil)
	if err != nil {
		t.Fatalf("expected object listing to succeed: %v", err)
	}
	if len(objects) != 1 || objects[0].Kind != "Database" || objects[0].Name != "postgres" || !objects[0].HasChildren {
		t.Fatalf("unexpected objects: %+v", objects)
	}
	if gotBody.OperationName != "AccessObjects" || !strings.Contains(gotBody.Query, "SourceObjects") {
		t.Fatalf("unexpected GraphQL request body: %+v", gotBody)
	}
	if len(gotBody.Variables) != 0 {
		t.Fatalf("expected no root variables, got %+v", gotBody.Variables)
	}
	if gotAuth == "" || !strings.HasPrefix(gotAuth, "Bearer ") {
		t.Fatalf("expected bearer credentials, got %q", gotAuth)
	}
}

func TestWhoDBHTTPClientListsSourceObjectsWithParentAndKindVariables(t *testing.T) {
	var gotBody struct {
		OperationName string         `json:"operationName"`
		Query         string         `json:"query"`
		Variables     map[string]any `json:"variables"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/query" {
			t.Fatalf("unexpected WhoDB request target: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("failed to decode WhoDB request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"SourceObjects":[{"Ref":{"Kind":"Table","Path":["postgres","public","users"]},"Kind":"Table","Name":"users","Path":["postgres","public","users"],"HasChildren":false,"Metadata":[{"Key":"Type","Value":"BASE TABLE"}]}]}}`))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	objects, err := client.ListObjects(
		context.Background(),
		WhoDBSourceCredentials{SourceType: "Postgres"},
		&WhoDBObjectRef{Kind: "Schema", Path: []string{"postgres", "public"}},
		[]string{"Table"},
	)
	if err != nil {
		t.Fatalf("expected child object listing to succeed: %v", err)
	}
	if len(objects) != 1 || objects[0].Kind != "Table" || objects[0].Name != "users" || objects[0].Metadata["Type"] != "BASE TABLE" {
		t.Fatalf("unexpected objects: %+v", objects)
	}
	if gotBody.OperationName != "AccessObjects" || !strings.Contains(gotBody.Query, "SourceObjects") {
		t.Fatalf("unexpected GraphQL request body: %+v", gotBody)
	}
	parent, ok := gotBody.Variables["parent"].(map[string]any)
	if !ok || parent["Kind"] != "Schema" {
		t.Fatalf("expected schema parent variable, got %+v", gotBody.Variables)
	}
	kinds, ok := gotBody.Variables["kinds"].([]any)
	if !ok || len(kinds) != 1 || kinds[0] != "Table" {
		t.Fatalf("expected table kind variable, got %+v", gotBody.Variables)
	}
}

func TestWhoDBHTTPClientGetsSourceObjectWithRefVariable(t *testing.T) {
	var gotBody struct {
		OperationName string         `json:"operationName"`
		Query         string         `json:"query"`
		Variables     map[string]any `json:"variables"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/query" {
			t.Fatalf("unexpected WhoDB request target: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("failed to decode WhoDB request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"SourceObject":{"Ref":{"Kind":"Table","Path":["postgres","public","users"]},"Kind":"Table","Name":"users","Path":["postgres","public","users"],"HasChildren":false,"Metadata":[{"Key":"Type","Value":"BASE TABLE"}]}}}`))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	object, err := client.GetObject(
		context.Background(),
		WhoDBSourceCredentials{SourceType: "Postgres"},
		WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
	)
	if err != nil {
		t.Fatalf("expected object lookup to succeed: %v", err)
	}
	if object == nil || object.Kind != "Table" || object.Name != "users" || object.Metadata["Type"] != "BASE TABLE" {
		t.Fatalf("unexpected object: %+v", object)
	}
	if gotBody.OperationName != "AccessObject" || !strings.Contains(gotBody.Query, "SourceObject") {
		t.Fatalf("unexpected GraphQL request body: %+v", gotBody)
	}
	ref, ok := gotBody.Variables["ref"].(map[string]any)
	if !ok || ref["Kind"] != "Table" {
		t.Fatalf("expected object ref variable, got %+v", gotBody.Variables)
	}
	path, ok := ref["Path"].([]any)
	if !ok || len(path) != 3 || path[2] != "users" {
		t.Fatalf("expected object ref path variable, got %+v", gotBody.Variables)
	}
}

func TestWhoDBHTTPClientMapsSourceObjectNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"SourceObject":null},"errors":[{"message":"source object not found"}]}`))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	_, err := client.GetObject(
		context.Background(),
		WhoDBSourceCredentials{SourceType: "Postgres"},
		WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "missing"}},
	)
	if err == nil || !errors.Is(err, ErrAccessObjectsNotFound) {
		t.Fatalf("expected source object not found mapping, got %v", err)
	}
}

func TestWhoDBHTTPClientMapsQueryLevelDatabaseErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":null,"errors":[{"message":"ERROR: could not open file \"postgresql-2.csv\" for reading (SQLSTATE 58P01)"}]}`))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	_, err := client.ReadRows(
		context.Background(),
		WhoDBSourceCredentials{SourceType: "Postgres"},
		WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "postgres_log"}},
		100,
		0,
		nil,
	)
	var queryErr *WhoDBQueryError
	if !errors.As(err, &queryErr) {
		t.Fatalf("expected query-level database error, got %v", err)
	}
	if !strings.Contains(queryErr.Message, "could not open file") {
		t.Fatalf("expected the database's own message preserved, got %q", queryErr.Message)
	}
	if errors.Is(err, ErrAccessHealthWhoDBUnavailable) {
		t.Fatalf("expected query-level error not to read as unavailability, got %v", err)
	}
	if errors.Is(err, ErrAccessObjectsNotFound) {
		t.Fatalf("expected query-level error not to read as not-found, got %v", err)
	}
}

func TestWhoDBHTTPClientKeepsTransportFailuresUnavailable(t *testing.T) {
	handlers := []struct {
		name    string
		handler http.HandlerFunc
	}{
		{name: "http 5xx", handler: func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) }},
		{name: "http 4xx", handler: func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) }},
		{name: "undecodable response", handler: func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("not json")) }},
	}
	for _, tt := range handlers {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(tt.handler)
			defer server.Close()

			client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
			_, err := client.ListObjects(context.Background(), WhoDBSourceCredentials{SourceType: "Postgres"}, nil, nil)
			if !errors.Is(err, ErrAccessHealthWhoDBUnavailable) {
				t.Fatalf("expected transport failure to stay unavailable, got %v", err)
			}
		})
	}

	t.Run("connection refused", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
		client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
		server.Close()

		_, err := client.ListObjects(context.Background(), WhoDBSourceCredentials{SourceType: "Postgres"}, nil, nil)
		if !errors.Is(err, ErrAccessHealthWhoDBUnavailable) {
			t.Fatalf("expected connection failure to stay unavailable, got %v", err)
		}
	})
}

func TestWhoDBHTTPClientListsSourceColumnsWithRefVariable(t *testing.T) {
	var gotBody struct {
		OperationName string         `json:"operationName"`
		Query         string         `json:"query"`
		Variables     map[string]any `json:"variables"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/query" {
			t.Fatalf("unexpected WhoDB request target: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("failed to decode WhoDB request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"SourceColumns":[{"Name":"id","Type":"integer","IsPrimary":true,"IsForeignKey":false},{"Name":"team_id","Type":"integer","IsPrimary":false,"IsForeignKey":true,"ReferencedTable":"teams","ReferencedColumn":"id"},{"Name":"email","Type":"varchar","IsPrimary":false,"IsForeignKey":false,"Length":320}]}}`))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	columns, err := client.ListColumns(
		context.Background(),
		WhoDBSourceCredentials{SourceType: "Postgres"},
		WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
	)
	if err != nil {
		t.Fatalf("expected column lookup to succeed: %v", err)
	}
	if len(columns) != 3 {
		t.Fatalf("expected three columns, got %+v", columns)
	}
	if !columns[0].IsPrimary || columns[0].Name != "id" || columns[0].Type != "integer" {
		t.Fatalf("unexpected primary column: %+v", columns[0])
	}
	if !columns[1].IsForeignKey || columns[1].ReferencedTable == nil || *columns[1].ReferencedTable != "teams" {
		t.Fatalf("unexpected foreign key column: %+v", columns[1])
	}
	if columns[2].Length == nil || *columns[2].Length != 320 {
		t.Fatalf("unexpected length metadata: %+v", columns[2])
	}
	if gotBody.OperationName != "AccessColumns" || !strings.Contains(gotBody.Query, "SourceColumns") {
		t.Fatalf("unexpected GraphQL request body: %+v", gotBody)
	}
	ref, ok := gotBody.Variables["ref"].(map[string]any)
	if !ok || ref["Kind"] != "Table" {
		t.Fatalf("expected object ref variable, got %+v", gotBody.Variables)
	}
}

func TestWhoDBHTTPClientReadsSourceRowsWithFixedPaginationAndSortVariables(t *testing.T) {
	var gotBody struct {
		OperationName string         `json:"operationName"`
		Query         string         `json:"query"`
		Variables     map[string]any `json:"variables"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/query" {
			t.Fatalf("unexpected WhoDB request target: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("failed to decode WhoDB request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"SourceRows":{"Columns":[{"Name":"id","Type":"integer","IsPrimary":true,"IsForeignKey":false},{"Name":"email","Type":"varchar","IsPrimary":false,"IsForeignKey":false,"Length":320}],"Rows":[["1","ada@example.com"]],"DisableUpdate":true,"TotalCount":1}}}`))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	rows, err := client.ReadRows(
		context.Background(),
		WhoDBSourceCredentials{SourceType: "Postgres"},
		WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
		25,
		50,
		[]WhoDBRowsSort{{Column: "created_at", Direction: "DESC"}},
	)
	if err != nil {
		t.Fatalf("expected row lookup to succeed: %v", err)
	}
	if rows == nil || len(rows.Columns) != 2 || len(rows.Rows) != 1 || rows.TotalCount != 1 {
		t.Fatalf("unexpected rows result: %+v", rows)
	}
	if gotBody.OperationName != "AccessRows" || !strings.Contains(gotBody.Query, "SourceRows") {
		t.Fatalf("unexpected GraphQL request body: %+v", gotBody)
	}
	if strings.Contains(gotBody.Query, "RunSourceQuery") || strings.Contains(strings.ToLower(gotBody.Query), "where") {
		t.Fatalf("rows query exposed unsupported query inputs: %s", gotBody.Query)
	}
	if _, ok := gotBody.Variables["query"]; ok {
		t.Fatalf("rows variables must not include raw query input: %+v", gotBody.Variables)
	}
	if _, ok := gotBody.Variables["where"]; ok {
		t.Fatalf("rows variables must not include where input: %+v", gotBody.Variables)
	}
	if gotBody.Variables["pageSize"] != float64(25) || gotBody.Variables["pageOffset"] != float64(50) {
		t.Fatalf("expected pagination variables, got %+v", gotBody.Variables)
	}
	sortVariables, ok := gotBody.Variables["sort"].([]any)
	if !ok || len(sortVariables) != 1 {
		t.Fatalf("expected one sort variable, got %+v", gotBody.Variables)
	}
	sortVariable, ok := sortVariables[0].(map[string]any)
	if !ok || sortVariable["Column"] != "created_at" || sortVariable["Direction"] != "DESC" {
		t.Fatalf("unexpected sort variable: %+v", gotBody.Variables)
	}
	ref, ok := gotBody.Variables["ref"].(map[string]any)
	if !ok || ref["Kind"] != "Table" {
		t.Fatalf("expected object ref variable, got %+v", gotBody.Variables)
	}
}

func TestWhoDBHTTPClientExportsSourceObjectWithBearerSourceCredentials(t *testing.T) {
	var gotAuth string
	var gotBody struct {
		Ref struct {
			Kind string   `json:"Kind"`
			Path []string `json:"Path"`
		} `json:"ref"`
		Format       string           `json:"format"`
		SelectedRows []map[string]any `json:"selectedRows,omitempty"`
		Query        string           `json:"query,omitempty"`
		Where        map[string]any   `json:"where,omitempty"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/export" {
			t.Fatalf("unexpected WhoDB export request target: %s %s", r.Method, r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("failed to decode WhoDB export request body: %v", err)
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="users.csv"`)
		_, _ = w.Write([]byte("id,email\n1,ada@example.com\n"))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	export, err := client.Export(
		context.Background(),
		WhoDBSourceCredentials{
			SourceType: "Postgres",
			Values: map[string]string{
				"Hostname": "pg-main-postgresql.ns-a.svc",
				"Port":     "5432",
				"Username": "alice",
				"Password": "s3cr3t",
				"Database": "postgres",
			},
		},
		WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
		"csv",
	)
	if err != nil {
		t.Fatalf("expected export to succeed: %v", err)
	}

	if export.ContentType != "text/csv; charset=utf-8" || export.Filename != "users.csv" || string(export.Body) != "id,email\n1,ada@example.com\n" {
		t.Fatalf("unexpected export response: %+v body=%q", export, string(export.Body))
	}
	if gotBody.Ref.Kind != "Table" || len(gotBody.Ref.Path) != 3 || gotBody.Ref.Path[2] != "users" || gotBody.Format != "csv" {
		t.Fatalf("unexpected export request body: %+v", gotBody)
	}
	if len(gotBody.SelectedRows) != 0 || gotBody.Query != "" || len(gotBody.Where) != 0 {
		t.Fatalf("export request must not include row values or query inputs: %+v", gotBody)
	}
	if gotAuth == "" || !strings.HasPrefix(gotAuth, "Bearer ") {
		t.Fatalf("expected bearer credentials, got %q", gotAuth)
	}
}

func TestWhoDBHTTPClientMapsSourceRowsTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"SourceRows":{"Columns":[],"Rows":[],"DisableUpdate":true,"TotalCount":0}}}`))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), 5*time.Millisecond)
	_, err := client.ReadRows(
		context.Background(),
		WhoDBSourceCredentials{SourceType: "Postgres"},
		WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
		100,
		0,
		nil,
	)
	if err == nil || !errors.Is(err, ErrAccessHealthWhoDBTimeout) {
		t.Fatalf("expected row timeout mapping, got %v", err)
	}
}

func TestWhoDBHTTPClientMapsExportTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		_, _ = w.Write([]byte("id\n1\n"))
	}))
	defer server.Close()

	client := NewWhoDBHTTPClient(server.URL, server.Client(), 5*time.Millisecond)
	_, err := client.Export(
		context.Background(),
		WhoDBSourceCredentials{SourceType: "Postgres"},
		WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
		"csv",
	)
	if err == nil || !errors.Is(err, ErrAccessHealthWhoDBTimeout) {
		t.Fatalf("expected export timeout mapping, got %v", err)
	}
}

func TestWhoDBHTTPClientMapsExportCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("cancelled export request should not reach WhoDB")
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	_, err := client.Export(
		ctx,
		WhoDBSourceCredentials{SourceType: "Postgres"},
		WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
		"csv",
	)
	if err == nil || !errors.Is(err, ErrAccessHealthWhoDBTimeout) {
		t.Fatalf("expected export cancellation to map to timeout, got %v", err)
	}
}

func TestWhoDBHTTPClientMapsSourceRowsCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("cancelled row request should not reach WhoDB")
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := NewWhoDBHTTPClient(server.URL, server.Client(), time.Second)
	_, err := client.ReadRows(
		ctx,
		WhoDBSourceCredentials{SourceType: "Postgres"},
		WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
		100,
		0,
		nil,
	)
	if err == nil || !errors.Is(err, ErrAccessHealthWhoDBTimeout) {
		t.Fatalf("expected row cancellation to map to timeout, got %v", err)
	}
}
