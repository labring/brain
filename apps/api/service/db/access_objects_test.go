package db

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestAccessObjectsListsRootObjectsThroughGuardedDBAccess(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		objects: []WhoDBObject{
			{
				Ref:         WhoDBObjectRef{Kind: "Database", Path: []string{"postgres"}},
				Kind:        "Database",
				Name:        "postgres",
				Path:        []string{"postgres"},
				HasChildren: true,
			},
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.List(context.Background(), AccessObjectsRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
	})
	if err != nil {
		t.Fatalf("expected object browsing to succeed: %v", err)
	}

	if len(result.Objects) != 1 {
		t.Fatalf("expected one root object, got %+v", result.Objects)
	}
	first := result.Objects[0]
	if first.Kind != "database" || first.Name != "postgres" || first.Ref.Kind != "database" || strings.Join(first.Ref.Path, "/") != "postgres" || !first.HasChildren {
		t.Fatalf("unexpected first root object: %+v", first)
	}

	if whodb.credentials.SourceType != "Postgres" || whodb.credentials.Values["Password"] != "s3cr3t" {
		t.Fatalf("expected generated WhoDB credentials, got %+v", whodb.credentials)
	}
	if whodb.parent != nil {
		t.Fatalf("expected root browsing without parent, got %+v", whodb.parent)
	}

	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("failed to marshal result: %v", err)
	}
	for _, forbidden := range []string{"s3cr3t", "alice", "pg-main-postgresql"} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("objects response exposed credential material %q: %s", forbidden, string(body))
		}
	}
}

func TestAccessObjectReturnsSafeMetadataThroughGuardedDBAccess(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		object: &WhoDBObject{
			Ref:         WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
			Kind:        "Table",
			Name:        "users",
			Path:        []string{"postgres", "public", "users"},
			HasChildren: false,
			Metadata: map[string]string{
				"Type": "BASE TABLE",
			},
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.Get(context.Background(), AccessObjectRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
	})
	if err != nil {
		t.Fatalf("expected object detail to succeed: %v", err)
	}

	if result.Object.Kind != "table" || result.Object.Name != "users" || result.Object.Metadata["Type"] != "BASE TABLE" {
		t.Fatalf("unexpected object detail: %+v", result.Object)
	}
	if whodb.ref == nil || whodb.ref.Kind != "Table" || strings.Join(whodb.ref.Path, "/") != "postgres/public/users" {
		t.Fatalf("expected WhoDB object lookup for returned ref, got %+v", whodb.ref)
	}
	if whodb.credentials.SourceType != "Postgres" || whodb.credentials.Values["Password"] != "s3cr3t" {
		t.Fatalf("expected generated WhoDB credentials, got %+v", whodb.credentials)
	}

	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("failed to marshal result: %v", err)
	}
	for _, forbidden := range []string{"s3cr3t", "alice", "pg-main-postgresql"} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("object response exposed credential material %q: %s", forbidden, string(body))
		}
	}
}

func TestAccessObjectFallsBackToParentListingWhenDirectLookupMissesReturnedRef(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		getErr: ErrAccessObjectsNotFound,
		objects: []WhoDBObject{
			{
				Ref:         WhoDBObjectRef{Kind: "View", Path: []string{"postgres", "public", "pg_auth_mon"}},
				Kind:        "View",
				Name:        "pg_auth_mon",
				Path:        []string{"postgres", "public", "pg_auth_mon"},
				HasChildren: false,
			},
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.Get(context.Background(), AccessObjectRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "view", Path: []string{"postgres", "public", "pg_auth_mon"}},
	})
	if err != nil {
		t.Fatalf("expected object detail fallback to succeed: %v", err)
	}

	if result.Object.Kind != "view" || result.Object.Name != "pg_auth_mon" {
		t.Fatalf("unexpected object detail fallback: %+v", result.Object)
	}
	if whodb.parent == nil || whodb.parent.Kind != "Schema" || strings.Join(whodb.parent.Path, "/") != "postgres/public" {
		t.Fatalf("expected fallback listing under schema parent, got %+v", whodb.parent)
	}
	if len(whodb.kinds) != 0 {
		t.Fatalf("expected fallback listing without WhoDB kind filter, got %+v", whodb.kinds)
	}
}

func TestAccessObjectPreservesNotFoundWhenFallbackCannotFindRef(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		getErr:  ErrAccessObjectsNotFound,
		objects: []WhoDBObject{},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	_, err := svc.Get(context.Background(), AccessObjectRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "missing"}},
	})
	if err == nil || !errors.Is(err, ErrAccessObjectsNotFound) {
		t.Fatalf("expected original not found error, got %v", err)
	}
}

func TestAccessColumnsReturnsColumnShapeThroughGuardedDBAccess(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		columns: []WhoDBColumn{
			{Name: "id", Type: "integer", IsPrimary: true},
			{
				Name:             "team_id",
				Type:             "integer",
				IsForeignKey:     true,
				ReferencedTable:  stringPointer("teams"),
				ReferencedColumn: stringPointer("id"),
			},
			{Name: "email", Type: "varchar", Length: intPointer(320)},
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.Columns(context.Background(), AccessColumnsRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
	})
	if err != nil {
		t.Fatalf("expected column inspection to succeed: %v", err)
	}

	if result.Ref.Kind != "table" || strings.Join(result.Ref.Path, "/") != "postgres/public/users" {
		t.Fatalf("unexpected result ref: %+v", result.Ref)
	}
	if whodb.ref == nil || whodb.ref.Kind != "Table" || strings.Join(whodb.ref.Path, "/") != "postgres/public/users" {
		t.Fatalf("expected WhoDB column lookup for returned ref, got %+v", whodb.ref)
	}
	if len(result.Columns) != 3 {
		t.Fatalf("expected three columns, got %+v", result.Columns)
	}
	if !result.Columns[0].IsPrimary || result.Columns[0].Name != "id" || result.Columns[0].Type != "integer" {
		t.Fatalf("unexpected primary column: %+v", result.Columns[0])
	}
	if !result.Columns[1].IsForeignKey || result.Columns[1].ReferencedTable == nil || *result.Columns[1].ReferencedTable != "teams" {
		t.Fatalf("unexpected foreign key column: %+v", result.Columns[1])
	}
	if result.Columns[2].Length == nil || *result.Columns[2].Length != 320 {
		t.Fatalf("unexpected length metadata: %+v", result.Columns[2])
	}

	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("failed to marshal result: %v", err)
	}
	for _, forbidden := range []string{"s3cr3t", "alice", "pg-main-postgresql"} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("columns response exposed credential material %q: %s", forbidden, string(body))
		}
	}
}

func TestAccessRowsReturnsRowsThroughGuardedDBAccessWithDefaultPagination(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		rows: &WhoDBRowsResult{
			Columns: []WhoDBColumn{
				{Name: "id", Type: "integer", IsPrimary: true},
				{Name: "email", Type: "varchar", Length: intPointer(320)},
			},
			Rows:       [][]string{{"1", "ada@example.com"}},
			TotalCount: 1,
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.Rows(context.Background(), AccessRowsRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
	})
	if err != nil {
		t.Fatalf("expected row retrieval to succeed: %v", err)
	}

	if result.Ref.Kind != "table" || strings.Join(result.Ref.Path, "/") != "postgres/public/users" {
		t.Fatalf("unexpected result ref: %+v", result.Ref)
	}
	if result.PageSize != 100 || result.PageOffset != 0 || result.TotalCount != 1 {
		t.Fatalf("unexpected pagination metadata: %+v", result)
	}
	if whodb.ref == nil || whodb.ref.Kind != "Table" || strings.Join(whodb.ref.Path, "/") != "postgres/public/users" {
		t.Fatalf("expected WhoDB row lookup for returned ref, got %+v", whodb.ref)
	}
	if whodb.pageSize != 100 || whodb.pageOffset != 0 || len(whodb.sort) != 0 {
		t.Fatalf("expected default WhoDB pagination without sort, got pageSize=%d pageOffset=%d sort=%+v", whodb.pageSize, whodb.pageOffset, whodb.sort)
	}
	if whodb.credentials.SourceType != "Postgres" || whodb.credentials.Values["Password"] != "s3cr3t" {
		t.Fatalf("expected generated WhoDB credentials, got %+v", whodb.credentials)
	}
	if len(result.Columns) != 2 || result.Columns[0].Name != "id" || !result.Columns[0].IsPrimary {
		t.Fatalf("unexpected columns: %+v", result.Columns)
	}
	if len(result.Rows) != 1 || strings.Join(result.Rows[0], ",") != "1,ada@example.com" {
		t.Fatalf("unexpected rows: %+v", result.Rows)
	}

	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("failed to marshal result: %v", err)
	}
	for _, forbidden := range []string{"s3cr3t", "alice", "pg-main-postgresql"} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("rows response exposed credential material %q: %s", forbidden, string(body))
		}
	}
}

func TestAccessExportReturnsCSVThroughGuardedDBAccess(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		export: &WhoDBExportResult{
			ContentType: "text/csv; charset=utf-8",
			Body:        []byte("id,email\n1,ada@example.com\n"),
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.Export(context.Background(), AccessExportRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
		Format:    "csv",
	})
	if err != nil {
		t.Fatalf("expected CSV export to succeed: %v", err)
	}

	if result.Format != "csv" || result.ContentType != "text/csv; charset=utf-8" {
		t.Fatalf("unexpected export metadata: %+v", result)
	}
	if string(result.Body) != "id,email\n1,ada@example.com\n" {
		t.Fatalf("unexpected CSV body: %q", string(result.Body))
	}
	if whodb.ref == nil || whodb.ref.Kind != "Table" || strings.Join(whodb.ref.Path, "/") != "postgres/public/users" {
		t.Fatalf("expected WhoDB export for returned ref, got %+v", whodb.ref)
	}
	if whodb.exportFormat != "csv" {
		t.Fatalf("expected CSV export format, got %q", whodb.exportFormat)
	}
	if whodb.credentials.SourceType != "Postgres" || whodb.credentials.Values["Password"] != "s3cr3t" {
		t.Fatalf("expected generated WhoDB credentials, got %+v", whodb.credentials)
	}
}

func TestAccessExportCapsCSVDataRowsAtMVPExportLimit(t *testing.T) {
	var exported strings.Builder
	exported.WriteString("id,email\n")
	for i := 1; i <= maxAccessExportRows+1; i++ {
		exported.WriteString(fmt.Sprintf("%d,user-%d@example.com\n", i, i))
	}

	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		export: &WhoDBExportResult{
			ContentType: "text/csv; charset=utf-8",
			Body:        []byte(exported.String()),
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.Export(context.Background(), AccessExportRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
		Format:    "csv",
	})
	if err != nil {
		t.Fatalf("expected capped CSV export to succeed: %v", err)
	}

	records, err := csv.NewReader(strings.NewReader(string(result.Body))).ReadAll()
	if err != nil {
		t.Fatalf("expected capped CSV to remain parseable: %v", err)
	}
	if len(records) != maxAccessExportRows+1 {
		t.Fatalf("expected header plus %d data rows, got %d records", maxAccessExportRows, len(records))
	}
	if records[0][0] != "id" || records[len(records)-1][0] != fmt.Sprintf("%d", maxAccessExportRows) {
		t.Fatalf("unexpected capped CSV boundary rows: first=%+v last=%+v", records[0], records[len(records)-1])
	}
	if result.RowLimit != maxAccessExportRows || result.RowsExported != maxAccessExportRows || !result.Truncated {
		t.Fatalf("expected row limit metadata, got %+v", result)
	}
}

func TestAccessExportReturnsNDJSONThroughGuardedDBAccess(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		export: &WhoDBExportResult{
			Body: []byte("{\"id\":1,\"email\":\"ada@example.com\"}\n{\"id\":2,\"email\":\"grace@example.com\"}\n"),
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.Export(context.Background(), AccessExportRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
		Format:    "ndjson",
	})
	if err != nil {
		t.Fatalf("expected NDJSON export to succeed: %v", err)
	}

	if result.Format != "ndjson" || result.ContentType != "application/x-ndjson; charset=utf-8" {
		t.Fatalf("unexpected NDJSON metadata: %+v", result)
	}
	if string(result.Body) != "{\"id\":1,\"email\":\"ada@example.com\"}\n{\"id\":2,\"email\":\"grace@example.com\"}\n" {
		t.Fatalf("unexpected NDJSON body: %q", string(result.Body))
	}
	if result.RowsExported != 2 || result.Truncated {
		t.Fatalf("unexpected NDJSON row metadata: %+v", result)
	}
	if whodb.exportFormat != "ndjson" {
		t.Fatalf("expected NDJSON export format, got %q", whodb.exportFormat)
	}
}

func TestAccessExportRejectsUnsupportedFormatsBeforeCallingWhoDB(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	_, err := svc.Export(context.Background(), AccessExportRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
		Format:    "excel",
	})
	if err == nil || !errors.Is(err, ErrAccessExportInvalidFormat) {
		t.Fatalf("expected invalid export format error, got %v", err)
	}
	if whodb.exportCalled != 0 {
		t.Fatalf("expected invalid export format to be rejected before WhoDB call")
	}
}

func TestAccessExportAuditIncludesFormatAndLimitButNotRowValues(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		export: &WhoDBExportResult{
			Body: []byte("id,email\n1,ada@example.com\n"),
		},
	}
	audit := &recordingAccessHealthAudit{}
	svc := AccessObjectsService{Store: store, WhoDB: whodb, Audit: audit}

	_, err := svc.Export(context.Background(), AccessExportRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
		Format:    "csv",
	})
	if err != nil {
		t.Fatalf("expected export to succeed: %v", err)
	}

	if audit.event.Operation != "db.access.export" || audit.event.Outcome != "ok" || audit.event.Engine != "postgresql" {
		t.Fatalf("unexpected audit event: %+v", audit.event)
	}
	if audit.event.Ref == nil || audit.event.Ref.Kind != "table" || strings.Join(audit.event.Ref.Path, "/") != "postgres/public/users" {
		t.Fatalf("expected audit ref metadata, got %+v", audit.event.Ref)
	}
	if audit.event.ExportFormat != "csv" || audit.event.RowLimit != maxAccessExportRows || audit.event.RowsExported != 1 || audit.event.Truncated {
		t.Fatalf("expected audit export metadata, got %+v", audit.event)
	}
	eventBytes, err := json.Marshal(audit.event)
	if err != nil {
		t.Fatalf("failed to marshal audit event: %v", err)
	}
	for _, forbidden := range []string{"ada@example.com", "s3cr3t", "alice", "pg-main-postgresql"} {
		if strings.Contains(string(eventBytes), forbidden) {
			t.Fatalf("audit event exposed %q: %s", forbidden, string(eventBytes))
		}
	}
}

func TestAccessRowsCapsLargePageSizesBeforeCallingWhoDB(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{rows: &WhoDBRowsResult{}}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.Rows(context.Background(), AccessRowsRequest{
		Name:       "pg-main",
		Namespace:  "ns-a",
		ProjectID:  "project-1",
		Ref:        AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
		PageSize:   1000,
		PageOffset: 25,
	})
	if err != nil {
		t.Fatalf("expected capped row retrieval to succeed: %v", err)
	}

	if result.PageSize != maxAccessRowsPageSize || result.PageOffset != 25 {
		t.Fatalf("unexpected pagination metadata: %+v", result)
	}
	if whodb.pageSize != maxAccessRowsPageSize || whodb.pageOffset != 25 {
		t.Fatalf("expected WhoDB to receive capped pagination, got pageSize=%d pageOffset=%d", whodb.pageSize, whodb.pageOffset)
	}
}

func TestAccessRowsRejectsInvalidPaginationBeforeCallingWhoDB(t *testing.T) {
	store := readyAccessObjectsStore()
	tests := []struct {
		name       string
		pageSize   int
		pageOffset int
	}{
		{name: "negative page size", pageSize: -1},
		{name: "negative page offset", pageOffset: -1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			whodb := &recordingWhoDBObjectClient{rows: &WhoDBRowsResult{}}
			svc := AccessObjectsService{Store: store, WhoDB: whodb}

			_, err := svc.Rows(context.Background(), AccessRowsRequest{
				Name:       "pg-main",
				Namespace:  "ns-a",
				ProjectID:  "project-1",
				Ref:        AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
				PageSize:   tt.pageSize,
				PageOffset: tt.pageOffset,
			})
			if err == nil || !errors.Is(err, ErrAccessRowsInvalidPagination) {
				t.Fatalf("expected invalid pagination error, got %v", err)
			}
			if whodb.rowsCalled != 0 {
				t.Fatalf("expected invalid pagination to be rejected before WhoDB call")
			}
		})
	}
}

func TestAccessRowsRejectsInvalidSortBeforeCallingWhoDB(t *testing.T) {
	store := readyAccessObjectsStore()
	tests := []struct {
		name string
		sort []AccessRowsSort
	}{
		{name: "blank column", sort: []AccessRowsSort{{Column: " ", Direction: "ASC"}}},
		{name: "unsupported direction", sort: []AccessRowsSort{{Column: "created_at", Direction: "sideways"}}},
		{name: "blank direction", sort: []AccessRowsSort{{Column: "created_at", Direction: " "}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			whodb := &recordingWhoDBObjectClient{rows: &WhoDBRowsResult{}}
			svc := AccessObjectsService{Store: store, WhoDB: whodb}

			_, err := svc.Rows(context.Background(), AccessRowsRequest{
				Name:      "pg-main",
				Namespace: "ns-a",
				ProjectID: "project-1",
				Ref:       AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
				Sort:      tt.sort,
			})
			if err == nil || !errors.Is(err, ErrAccessRowsInvalidSort) {
				t.Fatalf("expected invalid sort error, got %v", err)
			}
			if whodb.rowsCalled != 0 {
				t.Fatalf("expected invalid sort to be rejected before WhoDB call")
			}
		})
	}
}

func TestAccessRowsAuditIncludesPaginationAndSortButNotRowValues(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		rows: &WhoDBRowsResult{
			Columns:    []WhoDBColumn{{Name: "email", Type: "varchar"}},
			Rows:       [][]string{{"ada@example.com"}},
			TotalCount: 1,
		},
	}
	audit := &recordingAccessHealthAudit{}
	svc := AccessObjectsService{Store: store, WhoDB: whodb, Audit: audit}

	_, err := svc.Rows(context.Background(), AccessRowsRequest{
		Name:       "pg-main",
		Namespace:  "ns-a",
		ProjectID:  "project-1",
		Ref:        AccessObjectRef{Kind: "table", Path: []string{"postgres", "public", "users"}},
		PageSize:   50,
		PageOffset: 10,
		Sort:       []AccessRowsSort{{Column: "email", Direction: "desc"}},
	})
	if err != nil {
		t.Fatalf("expected row retrieval to succeed: %v", err)
	}

	if audit.event.Operation != "db.access.rows" || audit.event.Outcome != "ok" || audit.event.Engine != "postgresql" {
		t.Fatalf("unexpected audit event: %+v", audit.event)
	}
	if audit.event.Ref == nil || audit.event.Ref.Kind != "table" || strings.Join(audit.event.Ref.Path, "/") != "postgres/public/users" {
		t.Fatalf("expected audit ref metadata, got %+v", audit.event.Ref)
	}
	if audit.event.PageSize != 50 || audit.event.PageOffset != 10 {
		t.Fatalf("expected audit pagination metadata, got %+v", audit.event)
	}
	if len(audit.event.Sort) != 1 || audit.event.Sort[0].Column != "email" || audit.event.Sort[0].Direction != "DESC" {
		t.Fatalf("expected audit sort metadata, got %+v", audit.event.Sort)
	}
	eventBytes, err := json.Marshal(audit.event)
	if err != nil {
		t.Fatalf("failed to marshal audit event: %v", err)
	}
	if strings.Contains(string(eventBytes), "ada@example.com") {
		t.Fatalf("audit event exposed row values: %s", string(eventBytes))
	}
}

func TestAccessColumnsRejectsRefsThatDoNotExposeFields(t *testing.T) {
	store := readyAccessObjectsStore()
	svc := AccessObjectsService{Store: store, WhoDB: &recordingWhoDBObjectClient{}}

	_, err := svc.Columns(context.Background(), AccessColumnsRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Ref:       AccessObjectRef{Kind: "schema", Path: []string{"postgres", "public"}},
	})
	if err == nil || !errors.Is(err, ErrAccessObjectsUnsupportedKind) {
		t.Fatalf("expected unsupported ref kind, got %v", err)
	}
}

func TestAccessObjectsListsChildrenUnderReturnedRef(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		objects: []WhoDBObject{
			{
				Ref:         WhoDBObjectRef{Kind: "Schema", Path: []string{"postgres", "public"}},
				Kind:        "Schema",
				Name:        "public",
				Path:        []string{"postgres", "public"},
				HasChildren: true,
			},
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.List(context.Background(), AccessObjectsRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Parent:    &AccessObjectRef{Kind: "database", Path: []string{"postgres"}},
	})
	if err != nil {
		t.Fatalf("expected child object browsing to succeed: %v", err)
	}

	if whodb.parent == nil || whodb.parent.Kind != "Database" || strings.Join(whodb.parent.Path, "/") != "postgres" {
		t.Fatalf("expected WhoDB lookup under database ref, got %+v", whodb.parent)
	}
	if len(result.Objects) != 1 {
		t.Fatalf("expected one schema object, got %+v", result.Objects)
	}
	first := result.Objects[0]
	if first.Kind != "schema" || first.Name != "public" || first.Ref.Kind != "schema" || strings.Join(first.Ref.Path, "/") != "postgres/public" || !first.HasChildren {
		t.Fatalf("unexpected child object: %+v", first)
	}
}

func TestAccessObjectsPromoteSystemMarkerToTypedBoolean(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		objects: []WhoDBObject{
			{
				Ref:  WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
				Kind: "Table",
				Name: "users",
				Path: []string{"postgres", "public", "users"},
				Metadata: map[string]string{
					"Type": "BASE TABLE",
				},
			},
			{
				Ref:  WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "postgres_log"}},
				Kind: "Table",
				Name: "postgres_log",
				Path: []string{"postgres", "public", "postgres_log"},
				Metadata: map[string]string{
					"Type":                       "BASE TABLE",
					whoDBSystemObjectMetadataKey: "true",
				},
			},
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.List(context.Background(), AccessObjectsRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Parent:    &AccessObjectRef{Kind: "schema", Path: []string{"postgres", "public"}},
	})
	if err != nil {
		t.Fatalf("expected object browsing to succeed: %v", err)
	}
	if len(result.Objects) != 2 {
		t.Fatalf("expected both objects listed, got %+v", result.Objects)
	}
	if result.Objects[0].System {
		t.Fatalf("expected user table to stay non-system: %+v", result.Objects[0])
	}
	if !result.Objects[1].System {
		t.Fatalf("expected marked object promoted to system: %+v", result.Objects[1])
	}
	if result.Objects[1].Metadata["Type"] != "BASE TABLE" {
		t.Fatalf("expected remaining metadata preserved: %+v", result.Objects[1].Metadata)
	}

	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("failed to marshal result: %v", err)
	}
	if strings.Contains(string(body), whoDBSystemObjectMetadataKey) {
		t.Fatalf("expected transport marker stripped from the response: %s", string(body))
	}
}

func TestAccessObjectsNarrowsResultsByKind(t *testing.T) {
	store := readyAccessObjectsStore()
	whodb := &recordingWhoDBObjectClient{
		objects: []WhoDBObject{
			{
				Ref:  WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", "users"}},
				Kind: "Table",
				Name: "users",
				Path: []string{"postgres", "public", "users"},
				Metadata: map[string]string{
					"Type": "BASE TABLE",
				},
			},
		},
	}
	svc := AccessObjectsService{Store: store, WhoDB: whodb}

	result, err := svc.List(context.Background(), AccessObjectsRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
		Parent:    &AccessObjectRef{Kind: "schema", Path: []string{"postgres", "public"}},
		Kinds:     []string{"table"},
	})
	if err != nil {
		t.Fatalf("expected kind filtering to succeed: %v", err)
	}
	if got := strings.Join(whodb.kinds, ","); got != "Table" {
		t.Fatalf("expected WhoDB table kind filter, got %q", got)
	}
	if len(result.Objects) != 1 || result.Objects[0].Kind != "table" || result.Objects[0].Metadata["Type"] != "BASE TABLE" {
		t.Fatalf("unexpected filtered objects: %+v", result.Objects)
	}
}

func TestAccessObjectsRejectsInvalidRefsAndUnsupportedKinds(t *testing.T) {
	store := readyAccessObjectsStore()
	tests := []struct {
		name    string
		request AccessObjectsRequest
		wantErr error
	}{
		{
			name: "invalid schema ref path",
			request: AccessObjectsRequest{
				Name:      "pg-main",
				Namespace: "ns-a",
				ProjectID: "project-1",
				Parent:    &AccessObjectRef{Kind: "schema"},
			},
			wantErr: ErrAccessObjectsInvalidRef,
		},
		{
			name: "blank path segment",
			request: AccessObjectsRequest{
				Name:      "pg-main",
				Namespace: "ns-a",
				ProjectID: "project-1",
				Parent:    &AccessObjectRef{Kind: "schema", Path: []string{"postgres", ""}},
			},
			wantErr: ErrAccessObjectsInvalidRef,
		},
		{
			name: "unsupported requested kind",
			request: AccessObjectsRequest{
				Name:      "pg-main",
				Namespace: "ns-a",
				ProjectID: "project-1",
				Kinds:     []string{"row"},
			},
			wantErr: ErrAccessObjectsUnsupportedKind,
		},
		{
			name: "unsupported parent kind",
			request: AccessObjectsRequest{
				Name:      "pg-main",
				Namespace: "ns-a",
				ProjectID: "project-1",
				Parent:    &AccessObjectRef{Kind: "row", Path: []string{"postgres", "public", "users", "1"}},
			},
			wantErr: ErrAccessObjectsUnsupportedKind,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := AccessObjectsService{Store: store, WhoDB: &recordingWhoDBObjectClient{}}
			_, err := svc.List(context.Background(), tt.request)
			if err == nil || !errors.Is(err, tt.wantErr) {
				t.Fatalf("expected %v, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestAccessObjectsCapsLargeWhoDBListings(t *testing.T) {
	store := readyAccessObjectsStore()
	objects := make([]WhoDBObject, 0, maxAccessObjects+2)
	for i := range maxAccessObjects + 2 {
		name := fmt.Sprintf("table-%03d", i)
		objects = append(objects, WhoDBObject{
			Ref:  WhoDBObjectRef{Kind: "Table", Path: []string{"postgres", "public", name}},
			Kind: "Table",
			Name: name,
			Path: []string{"postgres", "public", name},
		})
	}
	svc := AccessObjectsService{
		Store: store,
		WhoDB: &recordingWhoDBObjectClient{
			objects: objects,
		},
	}

	result, err := svc.List(context.Background(), AccessObjectsRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
	})
	if err != nil {
		t.Fatalf("expected capped object browsing to succeed: %v", err)
	}
	if len(result.Objects) != maxAccessObjects {
		t.Fatalf("expected %d objects, got %d", maxAccessObjects, len(result.Objects))
	}
	if !result.Truncated {
		t.Fatalf("expected truncated result")
	}
}

func readyAccessObjectsStore() *fakeAccessHealthStore {
	return &fakeAccessHealthStore{
		db: readyAccessHealthDB("pg-main", "ns-a", "postgresql", "project-1"),
		secret: &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "pg-main-conn-credential", Namespace: "ns-a"},
			Data: map[string][]byte{
				"host":     []byte("pg-main-postgresql"),
				"port":     []byte("5432"),
				"username": []byte("alice"),
				"password": []byte("s3cr3t"),
			},
		},
	}
}

type recordingWhoDBObjectClient struct {
	credentials  WhoDBSourceCredentials
	parent       *WhoDBObjectRef
	ref          *WhoDBObjectRef
	kinds        []string
	exportFormat string
	pageSize     int
	pageOffset   int
	sort         []WhoDBRowsSort
	rowsCalled   int
	exportCalled int
	objects      []WhoDBObject
	object       *WhoDBObject
	columns      []WhoDBColumn
	rows         *WhoDBRowsResult
	export       *WhoDBExportResult
	err          error
	getErr       error
}

func (r *recordingWhoDBObjectClient) ListObjects(_ context.Context, credentials WhoDBSourceCredentials, parent *WhoDBObjectRef, kinds []string) ([]WhoDBObject, error) {
	r.credentials = credentials
	r.parent = parent
	r.kinds = kinds
	if r.err != nil {
		return nil, r.err
	}
	return r.objects, nil
}

func (r *recordingWhoDBObjectClient) GetObject(_ context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef) (*WhoDBObject, error) {
	r.credentials = credentials
	r.ref = &ref
	if r.getErr != nil {
		return nil, r.getErr
	}
	if r.err != nil {
		return nil, r.err
	}
	return r.object, nil
}

func (r *recordingWhoDBObjectClient) ListColumns(_ context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef) ([]WhoDBColumn, error) {
	r.credentials = credentials
	r.ref = &ref
	if r.err != nil {
		return nil, r.err
	}
	return r.columns, nil
}

func (r *recordingWhoDBObjectClient) ReadRows(_ context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef, pageSize int, pageOffset int, sort []WhoDBRowsSort) (*WhoDBRowsResult, error) {
	r.credentials = credentials
	r.ref = &ref
	r.pageSize = pageSize
	r.pageOffset = pageOffset
	r.sort = sort
	r.rowsCalled++
	if r.err != nil {
		return nil, r.err
	}
	return r.rows, nil
}

func (r *recordingWhoDBObjectClient) Export(_ context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef, format string) (*WhoDBExportResult, error) {
	r.credentials = credentials
	r.ref = &ref
	r.exportFormat = format
	r.exportCalled++
	if r.err != nil {
		return nil, r.err
	}
	return r.export, nil
}

func stringPointer(value string) *string {
	return &value
}

func intPointer(value int) *int {
	return &value
}
