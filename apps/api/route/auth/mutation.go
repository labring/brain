package auth

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"sealos/api/service/regiontoken"
)

func registerRegionToken(grp huma.API) {
	type regionTokenBody struct {
		RegionToken string `json:"regionToken" required:"true" doc:"Sealos region JWT; forwarded as Authorization to the cluster desktop /api/auth/regionToken route."`
	}
	type regionTokenInput struct {
		Body regionTokenBody
	}
	type regionTokenOutput struct {
		Body struct {
			EncodedKubeconfig string `json:"encodedKubeconfig" doc:"URL-encoded kubeconfig YAML (use as Bearer token for this API per standard auth)."`
			Namespace         string `json:"namespace" doc:"Namespace from the kubeconfig current context (may be empty)."`
		}
	}

	huma.Register(grp, huma.Operation{
		OperationID: "auth-region-token",
		Method:      http.MethodPost,
		Path:        "/regionToken",
		Summary:     "Exchange region token for encoded kubeconfig",
		Description: "Resolves the cluster desktop base URL from `SEALOS_DESKTOP_URL`, " +
			"calls `GET /api/auth/regionToken` on that host with `Authorization: <regionToken>`, then returns URL-encoded kubeconfig and namespace " +
			"derived from the returned kubeconfig.",
		Tags: []string{"Auth"},
	}, func(ctx context.Context, input *regionTokenInput) (*regionTokenOutput, error) {
		base, err := regiontoken.SealosDesktopBaseURL()
		if err != nil {
			return nil, huma.Error500InternalServerError("sealos desktop base URL (SEALOS_DESKTOP_URL)", err)
		}
		out, err := regiontoken.Exchange(ctx, base, input.Body.RegionToken)
		if err != nil {
			return nil, huma.Error502BadGateway("region token exchange failed", err)
		}
		resp := &regionTokenOutput{}
		resp.Body.EncodedKubeconfig = out.EncodedKubeconfig
		resp.Body.Namespace = out.Namespace
		return resp, nil
	})
}
