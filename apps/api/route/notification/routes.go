// Package notification exposes the Notification Center's platform stream:
// a read proxy over the upstream Notification CRs of the caller's namespace,
// authenticated with the caller's own kubeconfig bearer token (no standing
// credentials on the Brain side), plus the desktop-compatible mark-read patch.
package notification

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"sealos/api/middleware"
	notificationsvc "sealos/api/service/notification"
)

// BasePath is the group root; `main.go` accepts it with or without the slash.
const BasePath = "/api/notification/v1alpha1"

// Service seams, swapped by route tests for a fake cluster.
var (
	listNotifications    = notificationsvc.List
	markNotificationRead = notificationsvc.MarkRead
)

// Register adds the Notification API routes to the Huma API.
func Register(api huma.API) {
	grp := huma.NewGroup(api, BasePath)
	registerList(grp)
	registerMarkRead(grp)
}

func registerList(grp huma.API) {
	type listInput struct {
		middleware.AuthInput
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig)"`
	}
	type listOutput struct {
		Body notificationsvc.ListResult
	}

	huma.Register(grp, huma.Operation{
		OperationID: "notification-list",
		Method:      http.MethodGet,
		Path:        "/",
		Summary:     "List platform Notifications",
		Description: "List the upstream Notification CRs (`notifications.notification.sealos.io/v1`) of the resolved namespace, newest first. The platform writes and withdraws these; Brain only reads them. `isRead` mirrors the CR's `isRead` label — the same state the Sealos desktop's own inbox shows.",
		Tags:        []string{"Notification"},
	}, func(ctx context.Context, input *listInput) (*listOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		result, err := listNotifications(ctx, cfg, input.Namespace)
		if err != nil {
			return nil, mapK8sError("failed to list notifications", err)
		}
		return &listOutput{Body: *result}, nil
	})
}

func registerMarkRead(grp huma.API) {
	type markReadInput struct {
		middleware.AuthInput
		Name      string `path:"name" doc:"Notification CR metadata.name"`
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig)"`
	}
	type markReadOutput struct {
		Body notificationsvc.ReadResult
	}

	huma.Register(grp, huma.Operation{
		OperationID: "notification-mark-read",
		Method:      http.MethodPatch,
		Path:        "/{name}/read",
		Summary:     "Mark a platform Notification read",
		Description: "Merge-patch `metadata.labels.isRead: \"true\"` on one Notification CR — the write the Sealos desktop performs, so the desktop bell follows. Callers whose kubeconfig lacks patch permission (workspace Developers) receive 403; the Notification Center treats that as a best-effort skip because its own per-user receipt already records the read.",
		Tags:        []string{"Notification"},
	}, func(ctx context.Context, input *markReadInput) (*markReadOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		result, err := markNotificationRead(ctx, cfg, input.Namespace, input.Name)
		if err != nil {
			return nil, mapK8sError("failed to mark notification read", err)
		}
		return &markReadOutput{Body: *result}, nil
	})
}

func mapK8sError(message string, err error) error {
	switch {
	case apierrors.IsNotFound(err):
		return huma.Error404NotFound("notification not found", err)
	case apierrors.IsForbidden(err):
		return huma.Error403Forbidden("notification access forbidden", err)
	case apierrors.IsUnauthorized(err):
		return huma.Error401Unauthorized("invalid kubeconfig", err)
	default:
		return huma.Error500InternalServerError(message, err)
	}
}
