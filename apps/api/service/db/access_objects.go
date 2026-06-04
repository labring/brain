package db

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"io"
	"log"
	"strings"
	"time"
)

var (
	ErrAccessObjectsInvalidRef      = errors.New("invalid db object ref")
	ErrAccessObjectsNotFound        = errors.New("db object not found")
	ErrAccessObjectsUnsupportedKind = errors.New("unsupported db object kind")
	ErrAccessRowsInvalidPagination  = errors.New("invalid db row pagination")
	ErrAccessRowsInvalidSort        = errors.New("invalid db row sort")
	ErrAccessExportInvalidFormat    = errors.New("invalid db export format")
)

const (
	AccessObjectKindCollection = "collection"
	AccessObjectKindDatabase   = "database"
	AccessObjectKindFunction   = "function"
	AccessObjectKindIndex      = "index"
	AccessObjectKindItem       = "item"
	AccessObjectKindKey        = "key"
	AccessObjectKindProcedure  = "procedure"
	AccessObjectKindSchema     = "schema"
	AccessObjectKindSequence   = "sequence"
	AccessObjectKindTable      = "table"
	AccessObjectKindTrigger    = "trigger"
	AccessObjectKindView       = "view"
	defaultAccessRowsPageSize  = 100
	maxAccessRowsPageSize      = 500
	maxAccessObjects           = 500
	maxAccessExportRows        = 100000
)

type AccessObjectsRequest struct {
	Name      string
	Namespace string
	ProjectID string
	Parent    *AccessObjectRef
	Kinds     []string
}

type AccessObjectRequest struct {
	Name      string
	Namespace string
	ProjectID string
	Ref       AccessObjectRef
}

type AccessColumnsRequest struct {
	Name      string
	Namespace string
	ProjectID string
	Ref       AccessObjectRef
}

type AccessRowsRequest struct {
	Name       string
	Namespace  string
	ProjectID  string
	Ref        AccessObjectRef
	PageSize   int
	PageOffset int
	Sort       []AccessRowsSort
}

type AccessExportRequest struct {
	Name      string
	Namespace string
	ProjectID string
	Ref       AccessObjectRef
	Format    string
}

type AccessObjectRef struct {
	Kind string   `json:"kind"`
	Path []string `json:"path"`
}

type AccessRowsSort struct {
	Column    string `json:"column"`
	Direction string `json:"direction"`
}

type AccessObject struct {
	Ref         AccessObjectRef   `json:"ref"`
	Kind        string            `json:"kind"`
	Name        string            `json:"name"`
	DisplayName string            `json:"displayName,omitempty"`
	HasChildren bool              `json:"hasChildren"`
	ChildKinds  []string          `json:"childKinds,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

type AccessObjectsResult struct {
	Objects   []AccessObject `json:"objects"`
	Truncated bool           `json:"truncated"`
}

type AccessObjectResult struct {
	Object AccessObject `json:"object"`
}

type AccessColumn struct {
	Name             string  `json:"name"`
	Type             string  `json:"type"`
	IsPrimary        bool    `json:"isPrimary"`
	IsForeignKey     bool    `json:"isForeignKey"`
	ReferencedTable  *string `json:"referencedTable,omitempty"`
	ReferencedColumn *string `json:"referencedColumn,omitempty"`
	Length           *int    `json:"length,omitempty"`
	Precision        *int    `json:"precision,omitempty"`
	Scale            *int    `json:"scale,omitempty"`
}

type AccessColumnsResult struct {
	Ref     AccessObjectRef `json:"ref"`
	Columns []AccessColumn  `json:"columns"`
}

type AccessRowsResult struct {
	Ref        AccessObjectRef `json:"ref"`
	Columns    []AccessColumn  `json:"columns"`
	Rows       [][]string      `json:"rows"`
	PageSize   int             `json:"pageSize"`
	PageOffset int             `json:"pageOffset"`
	TotalCount int64           `json:"totalCount"`
}

type AccessExportResult struct {
	Ref          AccessObjectRef `json:"ref"`
	Format       string          `json:"format"`
	ContentType  string          `json:"contentType"`
	Filename     string          `json:"filename,omitempty"`
	RowLimit     int             `json:"rowLimit"`
	RowsExported int             `json:"rowsExported"`
	Truncated    bool            `json:"truncated"`
	Body         []byte          `json:"-"`
}

type WhoDBObjectRef struct {
	Kind string
	Path []string
}

type WhoDBObject struct {
	Ref         WhoDBObjectRef
	Kind        string
	Name        string
	Path        []string
	HasChildren bool
	Metadata    map[string]string
}

type WhoDBColumn struct {
	Name             string
	Type             string
	IsPrimary        bool
	IsForeignKey     bool
	ReferencedTable  *string
	ReferencedColumn *string
	Length           *int
	Precision        *int
	Scale            *int
}

type WhoDBRowsSort struct {
	Column    string
	Direction string
}

type WhoDBRowsResult struct {
	Columns       []WhoDBColumn
	Rows          [][]string
	DisableUpdate bool
	TotalCount    int64
}

type WhoDBExportResult struct {
	ContentType string
	Filename    string
	Body        []byte
}

type WhoDBObjectClient interface {
	ListObjects(ctx context.Context, credentials WhoDBSourceCredentials, parent *WhoDBObjectRef, kinds []string) ([]WhoDBObject, error)
	GetObject(ctx context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef) (*WhoDBObject, error)
	ListColumns(ctx context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef) ([]WhoDBColumn, error)
	ReadRows(ctx context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef, pageSize int, pageOffset int, sort []WhoDBRowsSort) (*WhoDBRowsResult, error)
	Export(ctx context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef, format string) (*WhoDBExportResult, error)
}

type AccessObjectsService struct {
	Store AccessHealthStore
	WhoDB WhoDBObjectClient
	Audit AccessHealthAuditLogger
}

func (s AccessObjectsService) List(ctx context.Context, req AccessObjectsRequest) (result *AccessObjectsResult, err error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Namespace = strings.TrimSpace(req.Namespace)
	req.ProjectID = strings.TrimSpace(req.ProjectID)
	start := time.Now()
	audit := AccessHealthAuditEvent{
		Operation: "db.access.objects",
		ProjectID: req.ProjectID,
		DBName:    req.Name,
		Namespace: req.Namespace,
		Outcome:   "error",
	}
	defer func() {
		if result != nil {
			audit.Outcome = "ok"
		}
		audit.Duration = time.Since(start)
		s.auditLogger().LogAccessHealth(audit)
	}()

	if req.ProjectID == "" {
		return nil, ErrAccessHealthProjectID
	}
	kindFilter, err := newAccessObjectKindFilter(req.Kinds)
	if err != nil {
		return nil, err
	}

	engine, credentials, err := guardDBAccess(ctx, s.Store, guardedAccessRequest{
		Name:      req.Name,
		Namespace: req.Namespace,
		ProjectID: req.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	audit.Engine = engine

	parent, err := accessObjectParentForWhoDB(req.Parent)
	if err != nil {
		return nil, err
	}
	kinds := kindFilter.whoDBKinds()
	objects, err := s.WhoDB.ListObjects(ctx, credentials, parent, kinds)
	if err != nil {
		return nil, err
	}
	resultObjects, err := accessObjectsFromWhoDB(objects, kindFilter)
	if err != nil {
		return nil, err
	}
	resultObjects, truncated := capAccessObjects(resultObjects)
	return &AccessObjectsResult{Objects: resultObjects, Truncated: truncated}, nil
}

func (s AccessObjectsService) Get(ctx context.Context, req AccessObjectRequest) (result *AccessObjectResult, err error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Namespace = strings.TrimSpace(req.Namespace)
	req.ProjectID = strings.TrimSpace(req.ProjectID)
	start := time.Now()
	audit := AccessHealthAuditEvent{
		Operation: "db.access.object",
		ProjectID: req.ProjectID,
		DBName:    req.Name,
		Namespace: req.Namespace,
		Outcome:   "error",
	}
	defer func() {
		if result != nil {
			audit.Outcome = "ok"
		}
		audit.Duration = time.Since(start)
		s.auditLogger().LogAccessHealth(audit)
	}()

	if req.ProjectID == "" {
		return nil, ErrAccessHealthProjectID
	}
	ref, kind, err := accessObjectRefForWhoDB(req.Ref)
	if err != nil {
		return nil, err
	}

	engine, credentials, err := guardDBAccess(ctx, s.Store, guardedAccessRequest{
		Name:      req.Name,
		Namespace: req.Namespace,
		ProjectID: req.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	audit.Engine = engine

	object, err := s.WhoDB.GetObject(ctx, credentials, ref)
	if err != nil {
		if !errors.Is(err, ErrAccessObjectsNotFound) {
			return nil, err
		}
		fallback, fallbackErr := s.getObjectFromParentListing(ctx, credentials, ref, kind)
		if fallbackErr != nil {
			return nil, err
		}
		return &AccessObjectResult{Object: *fallback}, nil
	}
	if object == nil {
		fallback, fallbackErr := s.getObjectFromParentListing(ctx, credentials, ref, kind)
		if fallbackErr != nil {
			return nil, ErrAccessObjectsNotFound
		}
		return &AccessObjectResult{Object: *fallback}, nil
	}
	mapped, err := accessObjectFromWhoDB(*object, nil)
	if err != nil {
		return nil, err
	}
	return &AccessObjectResult{Object: mapped}, nil
}

func (s AccessObjectsService) Columns(ctx context.Context, req AccessColumnsRequest) (result *AccessColumnsResult, err error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Namespace = strings.TrimSpace(req.Namespace)
	req.ProjectID = strings.TrimSpace(req.ProjectID)
	start := time.Now()
	audit := AccessHealthAuditEvent{
		Operation: "db.access.columns",
		ProjectID: req.ProjectID,
		DBName:    req.Name,
		Namespace: req.Namespace,
		Outcome:   "error",
	}
	defer func() {
		if result != nil {
			audit.Outcome = "ok"
		}
		audit.Duration = time.Since(start)
		s.auditLogger().LogAccessHealth(audit)
	}()

	if req.ProjectID == "" {
		return nil, ErrAccessHealthProjectID
	}
	ref, kind, err := accessColumnRefForWhoDB(req.Ref)
	if err != nil {
		return nil, err
	}

	engine, credentials, err := guardDBAccess(ctx, s.Store, guardedAccessRequest{
		Name:      req.Name,
		Namespace: req.Namespace,
		ProjectID: req.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	audit.Engine = engine

	columns, err := s.WhoDB.ListColumns(ctx, credentials, ref)
	if err != nil {
		return nil, err
	}
	return &AccessColumnsResult{
		Ref:     AccessObjectRef{Kind: kind, Path: ref.Path},
		Columns: accessColumnsFromWhoDB(columns),
	}, nil
}

func (s AccessObjectsService) Rows(ctx context.Context, req AccessRowsRequest) (result *AccessRowsResult, err error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Namespace = strings.TrimSpace(req.Namespace)
	req.ProjectID = strings.TrimSpace(req.ProjectID)
	start := time.Now()
	audit := AccessHealthAuditEvent{
		Operation: "db.access.rows",
		ProjectID: req.ProjectID,
		DBName:    req.Name,
		Namespace: req.Namespace,
		Outcome:   "error",
	}
	defer func() {
		if result != nil {
			audit.Outcome = "ok"
		}
		audit.Duration = time.Since(start)
		s.auditLogger().LogAccessHealth(audit)
	}()

	if req.ProjectID == "" {
		return nil, ErrAccessHealthProjectID
	}
	ref, kind, err := accessColumnRefForWhoDB(req.Ref)
	if err != nil {
		return nil, err
	}
	if req.PageSize < 0 || req.PageOffset < 0 {
		return nil, ErrAccessRowsInvalidPagination
	}
	pageSize := req.PageSize
	if pageSize == 0 {
		pageSize = defaultAccessRowsPageSize
	}
	if pageSize > maxAccessRowsPageSize {
		pageSize = maxAccessRowsPageSize
	}
	sort, err := accessRowsSortForWhoDB(req.Sort)
	if err != nil {
		return nil, err
	}
	audit.Ref = &AccessObjectRef{Kind: kind, Path: append([]string(nil), ref.Path...)}
	audit.PageSize = pageSize
	audit.PageOffset = req.PageOffset
	audit.Sort = accessRowsSortFromWhoDB(sort)

	engine, credentials, err := guardDBAccess(ctx, s.Store, guardedAccessRequest{
		Name:      req.Name,
		Namespace: req.Namespace,
		ProjectID: req.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	audit.Engine = engine

	rows, err := s.WhoDB.ReadRows(ctx, credentials, ref, pageSize, req.PageOffset, sort)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = &WhoDBRowsResult{}
	}
	return &AccessRowsResult{
		Ref:        AccessObjectRef{Kind: kind, Path: ref.Path},
		Columns:    accessColumnsFromWhoDB(rows.Columns),
		Rows:       rows.Rows,
		PageSize:   pageSize,
		PageOffset: req.PageOffset,
		TotalCount: rows.TotalCount,
	}, nil
}

func (s AccessObjectsService) Export(ctx context.Context, req AccessExportRequest) (result *AccessExportResult, err error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Namespace = strings.TrimSpace(req.Namespace)
	req.ProjectID = strings.TrimSpace(req.ProjectID)
	start := time.Now()
	audit := AccessHealthAuditEvent{
		Operation: "db.access.export",
		ProjectID: req.ProjectID,
		DBName:    req.Name,
		Namespace: req.Namespace,
		Outcome:   "error",
	}
	defer func() {
		if result != nil {
			audit.Outcome = "ok"
		}
		audit.Duration = time.Since(start)
		s.auditLogger().LogAccessHealth(audit)
	}()

	if req.ProjectID == "" {
		return nil, ErrAccessHealthProjectID
	}
	ref, kind, err := accessColumnRefForWhoDB(req.Ref)
	if err != nil {
		return nil, err
	}
	format, err := canonicalAccessExportFormat(req.Format)
	if err != nil {
		return nil, err
	}
	audit.Ref = &AccessObjectRef{Kind: kind, Path: append([]string(nil), ref.Path...)}
	audit.ExportFormat = format

	engine, credentials, err := guardDBAccess(ctx, s.Store, guardedAccessRequest{
		Name:      req.Name,
		Namespace: req.Namespace,
		ProjectID: req.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	audit.Engine = engine

	export, err := s.WhoDB.Export(ctx, credentials, ref, format)
	if err != nil {
		return nil, err
	}
	if export == nil {
		export = &WhoDBExportResult{}
	}
	body, rowsExported, truncated, err := capAccessExportBody(format, export.Body, maxAccessExportRows)
	if err != nil {
		return nil, err
	}
	audit.RowLimit = maxAccessExportRows
	audit.RowsExported = rowsExported
	audit.Truncated = truncated
	return &AccessExportResult{
		Ref:          AccessObjectRef{Kind: kind, Path: ref.Path},
		Format:       format,
		ContentType:  accessExportContentType(format, export.ContentType),
		Filename:     export.Filename,
		RowLimit:     maxAccessExportRows,
		RowsExported: rowsExported,
		Truncated:    truncated,
		Body:         body,
	}, nil
}

func (s AccessObjectsService) getObjectFromParentListing(ctx context.Context, credentials WhoDBSourceCredentials, ref WhoDBObjectRef, kind string) (*AccessObject, error) {
	parent := accessObjectDetailFallbackParent(ref, kind)
	if parent == nil {
		return nil, ErrAccessObjectsNotFound
	}
	objects, err := s.WhoDB.ListObjects(ctx, credentials, parent, nil)
	if err != nil {
		return nil, err
	}
	want := AccessObjectRef{Kind: kind, Path: cleanAccessObjectPath(ref.Path)}
	for _, object := range objects {
		mapped, err := accessObjectFromWhoDB(object, nil)
		if err != nil {
			return nil, err
		}
		if accessObjectRefsEqual(mapped.Ref, want) {
			return &mapped, nil
		}
	}
	return nil, ErrAccessObjectsNotFound
}

func accessObjectDetailFallbackParent(ref WhoDBObjectRef, kind string) *WhoDBObjectRef {
	path := cleanAccessObjectPath(ref.Path)
	if len(path) < 2 {
		return nil
	}
	parentPath := append([]string(nil), path[:len(path)-1]...)
	switch kind {
	case AccessObjectKindSchema, AccessObjectKindCollection:
		return &WhoDBObjectRef{Kind: whoDBKindForAccessObjectKind(AccessObjectKindDatabase), Path: parentPath}
	case AccessObjectKindFunction,
		AccessObjectKindProcedure,
		AccessObjectKindSequence,
		AccessObjectKindTable,
		AccessObjectKindTrigger,
		AccessObjectKindView:
		if len(path) < 3 {
			return nil
		}
		return &WhoDBObjectRef{Kind: whoDBKindForAccessObjectKind(AccessObjectKindSchema), Path: parentPath}
	case AccessObjectKindIndex, AccessObjectKindItem:
		return &WhoDBObjectRef{Kind: whoDBKindForAccessObjectKind(AccessObjectKindCollection), Path: parentPath}
	default:
		return nil
	}
}

func accessObjectRefsEqual(left, right AccessObjectRef) bool {
	if left.Kind != right.Kind || len(left.Path) != len(right.Path) {
		return false
	}
	for i := range left.Path {
		if left.Path[i] != right.Path[i] {
			return false
		}
	}
	return true
}

func accessObjectParentForWhoDB(parent *AccessObjectRef) (*WhoDBObjectRef, error) {
	if parent == nil {
		return nil, nil
	}
	ref, _, err := accessObjectRefForWhoDB(*parent)
	if err != nil {
		return nil, err
	}
	return &ref, nil
}

func accessRowsSortForWhoDB(sort []AccessRowsSort) ([]WhoDBRowsSort, error) {
	if len(sort) == 0 {
		return nil, nil
	}
	mapped := make([]WhoDBRowsSort, 0, len(sort))
	for _, item := range sort {
		column := strings.TrimSpace(item.Column)
		if column == "" {
			return nil, ErrAccessRowsInvalidSort
		}
		direction := strings.ToUpper(strings.TrimSpace(item.Direction))
		switch direction {
		case "ASC", "DESC":
		default:
			return nil, ErrAccessRowsInvalidSort
		}
		mapped = append(mapped, WhoDBRowsSort{
			Column:    column,
			Direction: direction,
		})
	}
	return mapped, nil
}

func accessRowsSortFromWhoDB(sort []WhoDBRowsSort) []AccessRowsSort {
	if len(sort) == 0 {
		return nil
	}
	mapped := make([]AccessRowsSort, 0, len(sort))
	for _, item := range sort {
		mapped = append(mapped, AccessRowsSort{
			Column:    item.Column,
			Direction: item.Direction,
		})
	}
	return mapped
}

func canonicalAccessExportFormat(format string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", "csv":
		return "csv", nil
	case "ndjson":
		return "ndjson", nil
	default:
		return "", ErrAccessExportInvalidFormat
	}
}

func accessExportContentType(format, contentType string) string {
	contentType = strings.TrimSpace(contentType)
	if contentType != "" {
		return contentType
	}
	if format == "ndjson" {
		return "application/x-ndjson; charset=utf-8"
	}
	return "text/csv; charset=utf-8"
}

func capAccessExportBody(format string, body []byte, rowLimit int) ([]byte, int, bool, error) {
	if rowLimit < 0 {
		rowLimit = 0
	}
	switch format {
	case "ndjson":
		return capAccessNDJSONExportBody(body, rowLimit)
	default:
		return capAccessCSVExportBody(body, rowLimit)
	}
}

func capAccessCSVExportBody(body []byte, rowLimit int) ([]byte, int, bool, error) {
	reader := csv.NewReader(bytes.NewReader(body))
	var out bytes.Buffer
	writer := csv.NewWriter(&out)

	header, err := reader.Read()
	if errors.Is(err, io.EOF) {
		return body, 0, false, nil
	}
	if err != nil {
		return nil, 0, false, err
	}
	if err := writer.Write(header); err != nil {
		return nil, 0, false, err
	}

	rowsExported := 0
	truncated := false
	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, rowsExported, false, err
		}
		if rowsExported >= rowLimit {
			truncated = true
			break
		}
		if err := writer.Write(record); err != nil {
			return nil, rowsExported, false, err
		}
		rowsExported++
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, rowsExported, false, err
	}
	return out.Bytes(), rowsExported, truncated, nil
}

func capAccessNDJSONExportBody(body []byte, rowLimit int) ([]byte, int, bool, error) {
	lines := bytes.SplitAfter(body, []byte("\n"))
	var out bytes.Buffer
	rowsExported := 0
	truncated := false
	for _, line := range lines {
		if len(line) == 0 {
			continue
		}
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		if rowsExported >= rowLimit {
			truncated = true
			break
		}
		if _, err := out.Write(line); err != nil {
			return nil, rowsExported, false, err
		}
		rowsExported++
	}
	return out.Bytes(), rowsExported, truncated, nil
}

func accessObjectRefForWhoDB(ref AccessObjectRef) (WhoDBObjectRef, string, error) {
	kind, err := canonicalAccessObjectKind(ref.Kind)
	if err != nil {
		return WhoDBObjectRef{}, "", err
	}
	path := cleanAccessObjectPath(ref.Path)
	if len(path) == 0 {
		return WhoDBObjectRef{}, "", ErrAccessObjectsInvalidRef
	}
	return WhoDBObjectRef{Kind: whoDBKindForAccessObjectKind(kind), Path: path}, kind, nil
}

func accessColumnRefForWhoDB(ref AccessObjectRef) (WhoDBObjectRef, string, error) {
	kind, err := canonicalAccessObjectKind(ref.Kind)
	if err != nil {
		return WhoDBObjectRef{}, "", err
	}
	if !accessObjectKindHasColumns(kind) {
		return WhoDBObjectRef{}, "", ErrAccessObjectsUnsupportedKind
	}
	path := cleanAccessObjectPath(ref.Path)
	if len(path) == 0 {
		return WhoDBObjectRef{}, "", ErrAccessObjectsInvalidRef
	}
	return WhoDBObjectRef{Kind: whoDBKindForAccessObjectKind(kind), Path: path}, kind, nil
}

func accessObjectKindHasColumns(kind string) bool {
	switch kind {
	case AccessObjectKindCollection, AccessObjectKindIndex, AccessObjectKindItem, AccessObjectKindKey, AccessObjectKindTable, AccessObjectKindView:
		return true
	default:
		return false
	}
}

func accessObjectsFromWhoDB(objects []WhoDBObject, kindFilter accessObjectKindFilter) ([]AccessObject, error) {
	mapped := make([]AccessObject, 0, len(objects))
	for _, object := range objects {
		accessObject, err := accessObjectFromWhoDB(object, kindFilter)
		if err != nil {
			return nil, err
		}
		if accessObject.Ref.Kind == "" {
			continue
		}
		mapped = append(mapped, accessObject)
	}
	return mapped, nil
}

func accessObjectFromWhoDB(object WhoDBObject, kindFilter accessObjectKindFilter) (AccessObject, error) {
	kind, err := accessObjectKindFromWhoDB(object.Kind)
	if err != nil {
		return AccessObject{}, err
	}
	if !kindFilter.allows(kind) {
		return AccessObject{}, nil
	}
	path := object.Ref.Path
	if len(path) == 0 {
		path = object.Path
	}
	path = cleanAccessObjectPath(path)
	if len(path) == 0 {
		return AccessObject{}, nil
	}
	name := strings.TrimSpace(object.Name)
	if name == "" {
		name = path[len(path)-1]
	}
	return AccessObject{
		Ref:         AccessObjectRef{Kind: kind, Path: path},
		Kind:        kind,
		Name:        name,
		DisplayName: name,
		HasChildren: object.HasChildren,
		Metadata:    object.Metadata,
	}, nil
}

func accessColumnsFromWhoDB(columns []WhoDBColumn) []AccessColumn {
	mapped := make([]AccessColumn, 0, len(columns))
	for _, column := range columns {
		name := strings.TrimSpace(column.Name)
		if name == "" {
			continue
		}
		mapped = append(mapped, AccessColumn{
			Name:             name,
			Type:             column.Type,
			IsPrimary:        column.IsPrimary,
			IsForeignKey:     column.IsForeignKey,
			ReferencedTable:  column.ReferencedTable,
			ReferencedColumn: column.ReferencedColumn,
			Length:           column.Length,
			Precision:        column.Precision,
			Scale:            column.Scale,
		})
	}
	return mapped
}

func capAccessObjects(objects []AccessObject) ([]AccessObject, bool) {
	if len(objects) <= maxAccessObjects {
		return objects, false
	}
	return objects[:maxAccessObjects], true
}

type accessObjectKindFilter map[string]struct{}

func newAccessObjectKindFilter(kinds []string) (accessObjectKindFilter, error) {
	if len(kinds) == 0 {
		return nil, nil
	}
	filter := make(accessObjectKindFilter, len(kinds))
	for _, kind := range kinds {
		canonical, err := canonicalAccessObjectKind(kind)
		if err != nil {
			return nil, err
		}
		filter[canonical] = struct{}{}
	}
	return filter, nil
}

func (f accessObjectKindFilter) allows(kind string) bool {
	if len(f) == 0 {
		return true
	}
	_, ok := f[kind]
	return ok
}

func (f accessObjectKindFilter) whoDBKinds() []string {
	if len(f) == 0 {
		return nil
	}
	kinds := make([]string, 0, len(f))
	for kind := range f {
		kinds = append(kinds, whoDBKindForAccessObjectKind(kind))
	}
	return kinds
}

func canonicalAccessObjectKind(kind string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case AccessObjectKindCollection:
		return AccessObjectKindCollection, nil
	case AccessObjectKindDatabase:
		return AccessObjectKindDatabase, nil
	case AccessObjectKindFunction:
		return AccessObjectKindFunction, nil
	case AccessObjectKindIndex:
		return AccessObjectKindIndex, nil
	case AccessObjectKindItem:
		return AccessObjectKindItem, nil
	case AccessObjectKindKey:
		return AccessObjectKindKey, nil
	case AccessObjectKindProcedure:
		return AccessObjectKindProcedure, nil
	case AccessObjectKindSchema:
		return AccessObjectKindSchema, nil
	case AccessObjectKindSequence:
		return AccessObjectKindSequence, nil
	case AccessObjectKindTable:
		return AccessObjectKindTable, nil
	case AccessObjectKindTrigger:
		return AccessObjectKindTrigger, nil
	case AccessObjectKindView:
		return AccessObjectKindView, nil
	default:
		return "", ErrAccessObjectsUnsupportedKind
	}
}

func whoDBKindForAccessObjectKind(kind string) string {
	switch kind {
	case AccessObjectKindCollection:
		return "Collection"
	case AccessObjectKindDatabase:
		return "Database"
	case AccessObjectKindFunction:
		return "Function"
	case AccessObjectKindIndex:
		return "Index"
	case AccessObjectKindItem:
		return "Item"
	case AccessObjectKindKey:
		return "Key"
	case AccessObjectKindProcedure:
		return "Procedure"
	case AccessObjectKindSchema:
		return "Schema"
	case AccessObjectKindSequence:
		return "Sequence"
	case AccessObjectKindTable:
		return "Table"
	case AccessObjectKindTrigger:
		return "Trigger"
	case AccessObjectKindView:
		return "View"
	default:
		return ""
	}
}

func accessObjectKindFromWhoDB(kind string) (string, error) {
	switch strings.TrimSpace(kind) {
	case "Collection":
		return AccessObjectKindCollection, nil
	case "Database":
		return AccessObjectKindDatabase, nil
	case "Function":
		return AccessObjectKindFunction, nil
	case "Index":
		return AccessObjectKindIndex, nil
	case "Item":
		return AccessObjectKindItem, nil
	case "Key":
		return AccessObjectKindKey, nil
	case "Procedure":
		return AccessObjectKindProcedure, nil
	case "Schema":
		return AccessObjectKindSchema, nil
	case "Sequence":
		return AccessObjectKindSequence, nil
	case "Table":
		return AccessObjectKindTable, nil
	case "Trigger":
		return AccessObjectKindTrigger, nil
	case "View":
		return AccessObjectKindView, nil
	default:
		return "", ErrAccessObjectsUnsupportedKind
	}
}

func cleanAccessObjectPath(path []string) []string {
	cleaned := make([]string, 0, len(path))
	for _, part := range path {
		part = strings.TrimSpace(part)
		if part == "" {
			return nil
		}
		cleaned = append(cleaned, part)
	}
	return cleaned
}

func (s AccessObjectsService) auditLogger() AccessHealthAuditLogger {
	if s.Audit != nil {
		return s.Audit
	}
	return standardAccessObjectsAuditLogger{}
}

type standardAccessObjectsAuditLogger struct{}

func (standardAccessObjectsAuditLogger) LogAccessHealth(event AccessHealthAuditEvent) {
	refKind := ""
	refPath := ""
	if event.Ref != nil {
		refKind = event.Ref.Kind
		refPath = strings.Join(event.Ref.Path, "/")
	}
	log.Printf(
		"db access objects: operation=%s project=%s db=%s namespace=%s engine=%s refKind=%s refPath=%s pageSize=%d pageOffset=%d sort=%s exportFormat=%s rowLimit=%d rowsExported=%d truncated=%t duration=%s outcome=%s",
		event.Operation,
		event.ProjectID,
		event.DBName,
		event.Namespace,
		event.Engine,
		refKind,
		refPath,
		event.PageSize,
		event.PageOffset,
		accessRowsSortLogValue(event.Sort),
		event.ExportFormat,
		event.RowLimit,
		event.RowsExported,
		event.Truncated,
		event.Duration,
		event.Outcome,
	)
}

func accessRowsSortLogValue(sort []AccessRowsSort) string {
	if len(sort) == 0 {
		return ""
	}
	parts := make([]string, 0, len(sort))
	for _, item := range sort {
		parts = append(parts, item.Column+":"+item.Direction)
	}
	return strings.Join(parts, ",")
}
