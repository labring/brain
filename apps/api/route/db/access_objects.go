package db

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"sealos/api/middleware"
	dbsvc "sealos/api/service/db"
)

const (
	accessWhoDBTimeout       = 15 * time.Second
	accessExportWhoDBTimeout = 120 * time.Second
)

func registerAccessObjects(grp huma.API) {
	type dbAccessObjectsBody struct {
		ProjectID string                 `json:"projectId" doc:"Brain Project ID that must match the brain.io/project-id DB ownership label."`
		Namespace string                 `json:"namespace,omitempty" doc:"Namespace (default from kubeconfig; admin can override)."`
		Parent    *dbsvc.AccessObjectRef `json:"parent,omitempty" doc:"Returned object ref to browse children under. Omit or set null to list root objects."`
		Kinds     []string               `json:"kinds,omitempty" doc:"Optional object kinds to include. Supported values include database, schema, table, view, collection, key, and index."`
	}
	type dbAccessObjectsInput struct {
		middleware.AuthInput
		Name string `path:"name" doc:"DB metadata.name."`
		Body dbAccessObjectsBody
	}
	type dbAccessObjectsOutput struct {
		Body dbsvc.AccessObjectsResult
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-access-objects",
		Method:      http.MethodPost,
		Path:        "/{name}/access/objects",
		Summary:     "Browse DB objects",
		Description: "Lists read-only database objects for one managed DB. Requires kubeconfig authorization and Brain Project ID ownership. Credentials and WhoDB operation details stay server-side.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbAccessObjectsInput) (*dbAccessObjectsOutput, error) {
		projectID := strings.TrimSpace(input.Body.ProjectID)
		namespace, service, err := accessObjectsServiceFromAuth(input.Authorization, input.Body.Namespace, projectID)
		if err != nil {
			return nil, err
		}
		result, err := service.List(ctx, dbsvc.AccessObjectsRequest{
			Name:      input.Name,
			Namespace: namespace,
			ProjectID: projectID,
			Parent:    input.Body.Parent,
			Kinds:     input.Body.Kinds,
		})
		if err != nil {
			return nil, accessObjectsError(err)
		}
		return &dbAccessObjectsOutput{Body: *result}, nil
	})
}

func registerAccessObject(grp huma.API) {
	type dbAccessObjectBody struct {
		ProjectID string                `json:"projectId" doc:"Brain Project ID that must match the brain.io/project-id DB ownership label."`
		Namespace string                `json:"namespace,omitempty" doc:"Namespace (default from kubeconfig; admin can override)."`
		Ref       dbsvc.AccessObjectRef `json:"ref" required:"true" doc:"Returned object ref to inspect."`
	}
	type dbAccessObjectInput struct {
		middleware.AuthInput
		Name string `path:"name" doc:"DB metadata.name."`
		Body dbAccessObjectBody
	}
	type dbAccessObjectOutput struct {
		Body dbsvc.AccessObjectResult
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-access-object",
		Method:      http.MethodPost,
		Path:        "/{name}/access/object",
		Summary:     "Inspect DB object",
		Description: "Returns safe read-only metadata for one returned database object ref. Requires kubeconfig authorization and Brain Project ID ownership. Credentials and WhoDB operation details stay server-side.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbAccessObjectInput) (*dbAccessObjectOutput, error) {
		projectID := strings.TrimSpace(input.Body.ProjectID)
		namespace, service, err := accessObjectsServiceFromAuth(input.Authorization, input.Body.Namespace, projectID)
		if err != nil {
			return nil, err
		}
		result, err := service.Get(ctx, dbsvc.AccessObjectRequest{
			Name:      input.Name,
			Namespace: namespace,
			ProjectID: projectID,
			Ref:       input.Body.Ref,
		})
		if err != nil {
			return nil, accessObjectsError(err)
		}
		return &dbAccessObjectOutput{Body: *result}, nil
	})
}

func registerAccessColumns(grp huma.API) {
	type dbAccessColumnsBody struct {
		ProjectID string                `json:"projectId" doc:"Brain Project ID that must match the brain.io/project-id DB ownership label."`
		Namespace string                `json:"namespace,omitempty" doc:"Namespace (default from kubeconfig; admin can override)."`
		Ref       dbsvc.AccessObjectRef `json:"ref" required:"true" doc:"Returned table, view, collection, key, item, or index ref to inspect."`
	}
	type dbAccessColumnsInput struct {
		middleware.AuthInput
		Name string `path:"name" doc:"DB metadata.name."`
		Body dbAccessColumnsBody
	}
	type dbAccessColumnsOutput struct {
		Body dbsvc.AccessColumnsResult
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-access-columns",
		Method:      http.MethodPost,
		Path:        "/{name}/access/columns",
		Summary:     "Inspect DB object columns",
		Description: "Returns read-only column or field metadata for one supported database object ref. Requires kubeconfig authorization and Brain Project ID ownership. The response never includes row values or raw database credentials.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbAccessColumnsInput) (*dbAccessColumnsOutput, error) {
		projectID := strings.TrimSpace(input.Body.ProjectID)
		namespace, service, err := accessObjectsServiceFromAuth(input.Authorization, input.Body.Namespace, projectID)
		if err != nil {
			return nil, err
		}
		result, err := service.Columns(ctx, dbsvc.AccessColumnsRequest{
			Name:      input.Name,
			Namespace: namespace,
			ProjectID: projectID,
			Ref:       input.Body.Ref,
		})
		if err != nil {
			return nil, accessObjectsError(err)
		}
		return &dbAccessColumnsOutput{Body: *result}, nil
	})
}

func registerAccessRows(grp huma.API) {
	type dbAccessRowsBody struct {
		ProjectID  string                 `json:"projectId" doc:"Brain Project ID that must match the brain.io/project-id DB ownership label."`
		Namespace  string                 `json:"namespace,omitempty" doc:"Namespace (default from kubeconfig; admin can override)."`
		Ref        dbsvc.AccessObjectRef  `json:"ref" required:"true" doc:"Returned table, view, collection, key, item, or index ref to read."`
		PageSize   int                    `json:"pageSize,omitempty" doc:"Rows per page. Defaults to 100 and is capped at 500."`
		PageOffset int                    `json:"pageOffset,omitempty" doc:"Zero-based row offset for pagination."`
		Sort       []dbsvc.AccessRowsSort `json:"sort,omitempty" doc:"Optional fixed sort model. Each item requires column and ASC or DESC direction."`
	}
	type dbAccessRowsInput struct {
		middleware.AuthInput
		Name string `path:"name" doc:"DB metadata.name."`
		Body dbAccessRowsBody
	}
	type dbAccessRowsOutput struct {
		Body dbsvc.AccessRowsResult
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-access-rows",
		Method:      http.MethodPost,
		Path:        "/{name}/access/rows",
		Summary:     "Read DB object rows",
		Description: "Returns one bounded read-only page of rows for a supported database object ref. Requires kubeconfig authorization and Brain Project ID ownership. Arbitrary SQL, filters, writes, imports, and mutation-like behavior are not available through this endpoint.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbAccessRowsInput) (*dbAccessRowsOutput, error) {
		projectID := strings.TrimSpace(input.Body.ProjectID)
		namespace, service, err := accessObjectsServiceFromAuth(input.Authorization, input.Body.Namespace, projectID)
		if err != nil {
			return nil, err
		}
		result, err := service.Rows(ctx, dbsvc.AccessRowsRequest{
			Name:       input.Name,
			Namespace:  namespace,
			ProjectID:  projectID,
			Ref:        input.Body.Ref,
			PageSize:   input.Body.PageSize,
			PageOffset: input.Body.PageOffset,
			Sort:       input.Body.Sort,
		})
		if err != nil {
			return nil, accessObjectsError(err)
		}
		return &dbAccessRowsOutput{Body: *result}, nil
	})
}

func registerAccessExport(grp huma.API) {
	type dbAccessExportBody struct {
		ProjectID string                `json:"projectId" doc:"Brain Project ID that must match the brain.io/project-id DB ownership label."`
		Namespace string                `json:"namespace,omitempty" doc:"Namespace (default from kubeconfig; admin can override)."`
		Ref       dbsvc.AccessObjectRef `json:"ref" required:"true" doc:"Returned table, view, collection, key, item, or index ref to export."`
		Format    string                `json:"format,omitempty" enum:"csv,ndjson" doc:"Export format. Defaults to csv. Only csv and ndjson are supported."`
	}
	type dbAccessExportInput struct {
		middleware.AuthInput
		Name string `path:"name" doc:"DB metadata.name."`
		Body dbAccessExportBody
	}
	type dbAccessExportOutput struct {
		ContentType        string `header:"Content-Type"`
		ContentDisposition string `header:"Content-Disposition"`
		CacheControl       string `header:"Cache-Control"`
		Body               []byte
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-access-export",
		Method:      http.MethodPost,
		Path:        "/{name}/access/export",
		Summary:     "Export DB object data",
		Description: "Exports CSV or NDJSON data for a supported database object ref. Requires kubeconfig authorization and Brain Project ID ownership. Arbitrary SQL, selected client rows, writes, imports, and mutation-like behavior are not available through this endpoint.",
		Tags:        []string{"DB"},
		Responses: map[string]*huma.Response{
			"200": {
				Description: "Export file",
				Content: map[string]*huma.MediaType{
					"text/csv": {
						Schema: &huma.Schema{Type: "string", Format: "binary"},
					},
					"application/x-ndjson": {
						Schema: &huma.Schema{Type: "string", Format: "binary"},
					},
				},
			},
		},
	}, func(ctx context.Context, input *dbAccessExportInput) (*dbAccessExportOutput, error) {
		projectID := strings.TrimSpace(input.Body.ProjectID)
		namespace, service, err := accessObjectsServiceFromAuthWithTimeout(input.Authorization, input.Body.Namespace, projectID, accessExportWhoDBTimeout)
		if err != nil {
			return nil, err
		}
		result, err := service.Export(ctx, dbsvc.AccessExportRequest{
			Name:      input.Name,
			Namespace: namespace,
			ProjectID: projectID,
			Ref:       input.Body.Ref,
			Format:    input.Body.Format,
		})
		if err != nil {
			return nil, accessObjectsError(err)
		}
		return &dbAccessExportOutput{
			ContentType:        result.ContentType,
			ContentDisposition: `attachment; filename="` + accessExportFilename(input.Name, result) + `"`,
			CacheControl:       "no-cache, no-store, must-revalidate",
			Body:               result.Body,
		}, nil
	})
}

func accessObjectsServiceFromAuth(authorization, namespace, projectID string) (string, dbsvc.AccessObjectsService, error) {
	return accessObjectsServiceFromAuthWithTimeout(authorization, namespace, projectID, accessWhoDBTimeout)
}

func accessObjectsServiceFromAuthWithTimeout(authorization, namespace, projectID string, whodbTimeout time.Duration) (string, dbsvc.AccessObjectsService, error) {
	_, cfg, err := middleware.RestConfigFromAuth(authorization)
	if err != nil {
		return "", dbsvc.AccessObjectsService{}, huma.Error401Unauthorized("invalid kubeconfig", err)
	}
	if strings.TrimSpace(projectID) == "" {
		return "", dbsvc.AccessObjectsService{}, huma.Error400BadRequest("Brain Project ID is required", nil)
	}
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace: namespace, DefaultNamespace: ""})
	if err != nil {
		return "", dbsvc.AccessObjectsService{}, huma.Error500InternalServerError("failed to resolve request context", err)
	}

	store, err := dbsvc.NewKubernetesAccessHealthStore(resolved.RestConfig)
	if err != nil {
		return "", dbsvc.AccessObjectsService{}, huma.Error500InternalServerError("failed to initialize DB access store", err)
	}
	service := dbsvc.AccessObjectsService{
		Store: store,
		WhoDB: dbsvc.NewWhoDBHTTPClient(
			os.Getenv("WHODB_URL"),
			http.DefaultClient,
			whodbTimeout,
		),
	}
	return resolved.Namespace, service, nil
}

func accessObjectsError(err error) error {
	switch {
	case errors.Is(err, dbsvc.ErrAccessObjectsInvalidRef):
		return huma.Error422UnprocessableEntity("invalid DB object ref", err)
	case errors.Is(err, dbsvc.ErrAccessObjectsNotFound):
		return huma.Error404NotFound("DB object not found", err)
	case errors.Is(err, dbsvc.ErrAccessObjectsUnsupportedKind):
		return huma.Error422UnprocessableEntity("unsupported DB object kind", err)
	case errors.Is(err, dbsvc.ErrAccessRowsInvalidPagination):
		return huma.Error400BadRequest("invalid row pagination", err)
	case errors.Is(err, dbsvc.ErrAccessRowsInvalidSort):
		return huma.Error400BadRequest("invalid row sort", err)
	case errors.Is(err, dbsvc.ErrAccessExportInvalidFormat):
		return huma.Error400BadRequest("invalid export format", err)
	case errors.Is(err, dbsvc.ErrAccessHealthProjectID):
		return huma.Error400BadRequest("Brain Project ID is required", err)
	case errors.Is(err, dbsvc.ErrAccessHealthDBNotFound):
		return huma.Error404NotFound("DB not found", err)
	case errors.Is(err, dbsvc.ErrAccessHealthProjectForbidden):
		return huma.Error403Forbidden("DB does not belong to project", err)
	case errors.Is(err, dbsvc.ErrAccessHealthProjectMissing):
		return huma.Error409Conflict("DB is missing project ownership metadata", err)
	case errors.Is(err, dbsvc.ErrAccessHealthDBNotReady):
		return huma.Error409Conflict("DB is not ready", err)
	case errors.Is(err, dbsvc.ErrAccessHealthSecretMissing):
		return huma.Error409Conflict("DB connection secret is missing", err)
	case errors.Is(err, dbsvc.ErrAccessHealthUnsupported):
		return huma.Error422UnprocessableEntity("unsupported DB engine", err)
	case errors.Is(err, dbsvc.ErrAccessHealthWhoDBMissing):
		return huma.Error503ServiceUnavailable("WHODB_URL is not configured", err)
	case errors.Is(err, dbsvc.ErrAccessHealthWhoDBTimeout):
		return huma.Error504GatewayTimeout("WhoDB request timed out", err)
	case errors.Is(err, dbsvc.ErrAccessHealthWhoDBUnavailable):
		return huma.Error503ServiceUnavailable("WhoDB is unavailable", err)
	default:
		return huma.Error500InternalServerError("failed to browse DB objects", err)
	}
}

func accessExportFilename(dbName string, result *dbsvc.AccessExportResult) string {
	if result == nil {
		return "db-export.csv"
	}
	if result.Filename != "" {
		return sanitizeAccessExportFilename(result.Filename, result.Format)
	}
	name := strings.TrimSpace(dbName)
	if len(result.Ref.Path) > 0 {
		name += "-" + result.Ref.Path[len(result.Ref.Path)-1]
	}
	if strings.TrimSpace(name) == "" {
		name = "db-export"
	}
	return sanitizeAccessExportFilename(name+"."+accessExportExtension(result.Format), result.Format)
}

func sanitizeAccessExportFilename(name, format string) string {
	ext := accessExportExtension(format)
	base := filepath.Base(strings.TrimSpace(name))
	base = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		case r == '.', r == '-', r == '_':
			return r
		default:
			return '-'
		}
	}, base)
	base = strings.Trim(base, ".-")
	if base == "" {
		base = "db-export"
	}
	if !strings.HasSuffix(strings.ToLower(base), "."+ext) {
		base += "." + ext
	}
	return base
}

func accessExportExtension(format string) string {
	if strings.EqualFold(format, "ndjson") {
		return "ndjson"
	}
	return "csv"
}
