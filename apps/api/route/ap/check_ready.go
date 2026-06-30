package ap

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"sealos/api/middleware"
)

const apCheckReadyTimeout = 5 * time.Second
const apCheckReadyMaxRedirects = 3

type apCheckReadyItem struct {
	Error string `json:"error,omitempty"`
	Ready bool   `json:"ready"`
	URL   string `json:"url"`
}

type apCheckReadyHTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

type apCheckReadyTarget struct {
	Error string
	URL   string
}

func registerCheckReady(grp huma.API) {
	type checkReadyInput struct {
		middleware.AuthInput
		Name      string `query:"name" required:"true" doc:"AP instance name"`
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type checkReadyOutput struct {
		Body []apCheckReadyItem
	}

	huma.Register(grp, huma.Operation{
		OperationID: "ap-check-ready",
		Method:      http.MethodGet,
		Path:        "/check-ready",
		Summary:     "Check AP public address readiness",
		Description: "Fetches each projected AP public address from outside Kubernetes and reports whether the address is actually reachable. This complements Kubernetes workload readiness and public routing support status.",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *checkReadyInput) (*checkReadyOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if strings.TrimSpace(input.Name) == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}

		gvr := middleware.PodsGVR()
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Namespace,
			AllNamespaces:    false,
			DefaultNamespace: "",
			AdminCheckGVR:    &gvr,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		workload, err := currentAPWorkload(cfg, resolved.Namespace, input.Name)
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("AP not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to get AP", err)
		}
		apObject := workload.APObject()
		apObject, err = apObjectWithPublicAccessSupportResources(cfg, *workload, apObject)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt AP public addresses", err)
		}

		targets := apCheckReadyTargets(apObject, apCheckReadyWorkloadReady(*workload))
		results := apCheckReadyTargetsWithClient(ctx, targets, newAPCheckReadyHTTPClient())
		return &checkReadyOutput{Body: results}, nil
	})
}

func newAPCheckReadyHTTPClient() *http.Client {
	return &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= apCheckReadyMaxRedirects {
				return errAPCheckReadyRedirectBlocked
			}
			if !apCheckReadyURLAllowed(req.URL) {
				return errAPCheckReadyRedirectBlocked
			}
			return nil
		},
		Timeout: apCheckReadyTimeout,
		Transport: &http.Transport{
			DialContext: apCheckReadyDialContext,
		},
	}
}

func apCheckReadyURLs(apObject map[string]interface{}) []string {
	targets := apCheckReadyURLTargets(apObject)
	out := make([]string, 0, len(targets))
	for _, target := range targets {
		out = append(out, target.URL)
	}
	return out
}

func apCheckReadyTargets(apObject map[string]interface{}, workloadReady bool) []apCheckReadyTarget {
	targets := apCheckReadyURLTargets(apObject)
	for index, target := range targets {
		if !workloadReady {
			target.Error = "Pod not ready"
		} else if ok, reason := apCheckReadyPublicAddressIngressReady(target.URL, apObject); !ok {
			target.Error = reason
		}
		targets[index] = target
	}
	return targets
}

func apCheckReadyURLTargets(apObject map[string]interface{}) []apCheckReadyTarget {
	status, _ := apObject["status"].(map[string]interface{})
	network, _ := status["network"].(map[string]interface{})
	rows := apCheckReadyPublicAddressRows(network["publicAddresses"])
	out := make([]apCheckReadyTarget, 0, len(rows))
	seen := map[string]bool{}
	for _, row := range rows {
		normalized := normalizedCheckReadyURL(apCheckReadyRowURL(row))
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, apCheckReadyTarget{URL: normalized})
	}
	return out
}

func apCheckReadyRowURL(row map[string]interface{}) string {
	value := strings.TrimSpace(stringField(row["url"]))
	if value != "" {
		return value
	}
	host := strings.TrimSpace(stringField(row["host"]))
	if host == "" {
		return ""
	}
	return "https://" + host + "/"
}

func apCheckReadyPublicAddressRows(value interface{}) []map[string]interface{} {
	switch rows := value.(type) {
	case []map[string]interface{}:
		return rows
	case []interface{}:
		out := make([]map[string]interface{}, 0, len(rows))
		for _, item := range rows {
			row, _ := item.(map[string]interface{})
			if row != nil {
				out = append(out, row)
			}
		}
		return out
	default:
		return nil
	}
}

func apCheckReadyPublicAddressIngressReady(targetURL string, apObject map[string]interface{}) (bool, string) {
	status, _ := apObject["status"].(map[string]interface{})
	network, _ := status["network"].(map[string]interface{})
	rows := apCheckReadyPublicAddressRows(network["publicAddresses"])
	for _, row := range rows {
		if normalizedCheckReadyURL(apCheckReadyRowURL(row)) != targetURL {
			continue
		}
		rowStatus := strings.ToLower(strings.TrimSpace(stringField(row["status"])))
		reason := strings.TrimSpace(stringField(row["reason"]))
		if rowStatus == "blocked" || rowStatus == "failed" {
			if reason != "" {
				return false, reason
			}
			return false, rowStatus
		}
		if rowStatus == "accessible" {
			return true, ""
		}
		routing, _ := row["routing"].(map[string]interface{})
		routingStatus := strings.ToLower(strings.TrimSpace(stringField(routing["status"])))
		if routingStatus == "ready" {
			return true, ""
		}
		if routingStatus == "failed" {
			if reason := strings.TrimSpace(stringField(routing["reason"])); reason != "" {
				return false, reason
			}
			if message := strings.TrimSpace(stringField(routing["message"])); message != "" {
				return false, message
			}
		}
		return false, "Ingress not ready"
	}
	return false, "Ingress not ready"
}

func apCheckReadyWorkloadReady(workload apWorkload) bool {
	if workload.Deployment != nil {
		desired := int32(1)
		if workload.Deployment.Spec.Replicas != nil {
			desired = *workload.Deployment.Spec.Replicas
		}
		return desired > 0 &&
			workload.Deployment.Status.ReadyReplicas >= desired &&
			workload.Deployment.Status.AvailableReplicas >= desired
	}
	if workload.StatefulSet != nil {
		desired := int32(1)
		if workload.StatefulSet.Spec.Replicas != nil {
			desired = *workload.StatefulSet.Spec.Replicas
		}
		return desired > 0 && workload.StatefulSet.Status.ReadyReplicas >= desired
	}
	return false
}

func normalizedCheckReadyURL(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return ""
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}
	return parsed.String()
}

func apCheckReadyURLAllowed(parsed *url.URL) bool {
	if parsed == nil || parsed.Hostname() == "" {
		return false
	}
	return parsed.Scheme == "http" || parsed.Scheme == "https"
}

func apCheckReadyDialContext(ctx context.Context, network string, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	var target netip.Addr
	for _, ip := range ips {
		if apCheckReadyPublicAddr(ip) {
			target = ip
			break
		}
	}
	if !target.IsValid() {
		return nil, errAPCheckReadyPrivateTarget
	}
	dialer := net.Dialer{Timeout: apCheckReadyTimeout}
	return dialer.DialContext(ctx, network, net.JoinHostPort(target.String(), port))
}

var errAPCheckReadyPrivateTarget = &net.DNSError{
	Err:        "check-ready target resolves to a non-public address",
	IsNotFound: true,
}

var errAPCheckReadyRedirectBlocked = errors.New("check-ready redirect blocked")

func apCheckReadyPublicAddr(addr netip.Addr) bool {
	return addr.IsValid() &&
		addr.IsGlobalUnicast() &&
		!addr.IsPrivate() &&
		!addr.IsLoopback() &&
		!addr.IsLinkLocalUnicast() &&
		!addr.IsLinkLocalMulticast() &&
		!addr.IsMulticast() &&
		!addr.IsUnspecified()
}

func apCheckReadyTargetsWithClient(ctx context.Context, targets []apCheckReadyTarget, client apCheckReadyHTTPClient) []apCheckReadyItem {
	results := make([]apCheckReadyItem, len(targets))
	var wg sync.WaitGroup
	for index, target := range targets {
		index := index
		target := target
		wg.Add(1)
		go func() {
			defer wg.Done()
			if target.Error != "" {
				results[index] = apCheckReadyItem{
					Error: target.Error,
					URL:   target.URL,
				}
				return
			}
			results[index] = apCheckReadyURL(ctx, client, target.URL)
		}()
	}
	wg.Wait()
	return results
}

func apCheckReadyURL(ctx context.Context, client apCheckReadyHTTPClient, targetURL string) apCheckReadyItem {
	result := apCheckReadyItem{URL: targetURL}
	if client == nil {
		result.Error = "http client unavailable"
		return result
	}
	requestCtx, cancel := context.WithTimeout(ctx, apCheckReadyTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, targetURL, nil)
	if err != nil {
		result.Error = "invalid url"
		return result
	}
	resp, err := client.Do(req)
	if err != nil {
		result.Error = "fetch error"
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound && resp.Header.Get("Content-Length") == "0" {
		result.Error = "404"
		return result
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	bodyText := string(body)
	if resp.StatusCode == http.StatusServiceUnavailable &&
		(strings.Contains(bodyText, "upstream connect error") ||
			strings.Contains(bodyText, "upstream not health") ||
			strings.Contains(bodyText, "no healthy upstream")) {
		result.Error = "Upstream not healthy"
		return result
	}
	result.Ready = true
	return result
}

func stringField(value interface{}) string {
	str, _ := value.(string)
	return str
}
