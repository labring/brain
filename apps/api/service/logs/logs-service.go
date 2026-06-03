package logs

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/yaml"

	"sealos/api/middleware"
)

var (
	ErrUncompleteParam = errors.New("namespace and name are required")
	ErrInvalidKind     = errors.New("invalid logs kind: must be ap or db")
	ErrNoVLHost        = errors.New("unable to get the victoria-logs host")
	ErrNoPodsFound     = errors.New("no pods found")
	ErrNoAuthSecret    = errors.New("vmauth secret not found or missing credentials")
)

const (
	defaultLogLimitAll    = "10" // per pod+container when querying all
	defaultLogLimitSingle = "50" // when querying specific container
	defaultLogsRangeMin   = 60   // default time range in minutes
	instanceLabel         = "app.kubernetes.io/instance"
	appLabel              = "app"
)

// QueryOptions holds optional query parameters for log queries.
type QueryOptions struct {
	Start  string // unix timestamp seconds; empty = default
	End    string // unix timestamp seconds; empty = default
	Limit  string // max entries; empty = default (10 or 50)
	Search string // text search pattern; empty = no filter
}

// escapeLogsQLRegex escapes regex metacharacters for safe use in LogsQL _msg:~"..." filters.
func escapeLogsQLRegex(s string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`.`, `\.`,
		`*`, `\*`,
		`+`, `\+`,
		`?`, `\?`,
		`^`, `\^`,
		`$`, `\$`,
		`{`, `\{`,
		`}`, `\}`,
		`[`, `\[`,
		`]`, `\]`,
		`(`, `\(`,
		`)`, `\)`,
		`|`, `\|`,
		`"`, `\"`,
	)
	return replacer.Replace(s)
}

// vmauthCredentials holds cached credentials from vmauth secret.
type vmauthCredentials struct {
	username string
	password string
}

var (
	cachedCreds     *vmauthCredentials
	cachedCredsOnce sync.Once
	cachedCredsErr  error
)

// vmauthConfig represents the auth.yml structure in vmauth secret.
type vmauthConfig struct {
	Users []struct {
		Username  string   `yaml:"username"`
		Password  string   `yaml:"password"`
		URLPrefix []string `yaml:"url_prefix"`
	} `yaml:"users"`
}

// getVmauthCredentials fetches read credentials from vmauth secret.
// Uses VMAUTH_SECRET_NAMESPACE and VMAUTH_SECRET_NAME env vars.
// Caches result after first successful fetch.
func getVmauthCredentials(ctx context.Context) (string, string, error) {
	cachedCredsOnce.Do(func() {
		// First check env vars as fallback
		if username, password := os.Getenv("VLSELECT_USERNAME"), os.Getenv("VLSELECT_PASSWORD"); username != "" {
			cachedCreds = &vmauthCredentials{username: username, password: password}
			return
		}

		// Try to fetch from K8s secret
		secretNS := os.Getenv("VMAUTH_SECRET_NAMESPACE")
		secretName := os.Getenv("VMAUTH_SECRET_NAME")
		if secretNS == "" || secretName == "" {
			// No secret configured, no auth
			cachedCreds = &vmauthCredentials{}
			return
		}

		config, err := rest.InClusterConfig()
		if err != nil {
			cachedCredsErr = fmt.Errorf("failed to get in-cluster config: %w", err)
			return
		}
		middleware.SuppressK8sRESTWarnings(config)

		clientset, err := kubernetes.NewForConfig(config)
		if err != nil {
			cachedCredsErr = fmt.Errorf("failed to create k8s client: %w", err)
			return
		}

		secret, err := clientset.CoreV1().Secrets(secretNS).Get(ctx, secretName, metav1.GetOptions{})
		if err != nil {
			cachedCredsErr = fmt.Errorf("failed to get vmauth secret: %w", err)
			return
		}

		authYAML, ok := secret.Data["auth.yml"]
		if !ok {
			cachedCredsErr = ErrNoAuthSecret
			return
		}

		var authConfig vmauthConfig
		if err := yaml.Unmarshal(authYAML, &authConfig); err != nil {
			cachedCredsErr = fmt.Errorf("failed to parse auth.yml: %w", err)
			return
		}

		// Find the "read" user
		for _, user := range authConfig.Users {
			if user.Username == "read" {
				cachedCreds = &vmauthCredentials{username: user.Username, password: user.Password}
				return
			}
		}

		cachedCredsErr = ErrNoAuthSecret
	})

	if cachedCredsErr != nil {
		return "", "", cachedCredsErr
	}
	if cachedCreds == nil {
		return "", "", nil
	}
	return cachedCreds.username, cachedCreds.password, nil
}

// escapeLogsQLString escapes single quotes in LogsQL string literals.
func escapeLogsQLString(s string) string {
	return strings.ReplaceAll(s, "'", "\\'")
}

// QueryAppLogs queries VictoriaLogs for app/launchpad logs.
// Finds pods by label app=<name>, then queries logs for each pod+container.
// If container is empty, queries all pod+container combinations with limit 10 each.
// If container is specified, queries only that container with limit 50.
// Returns map keyed by "pod/container".
func QueryAppLogs(ctx context.Context, restConfig *rest.Config, namespace, name, container string, opts QueryOptions) (map[string][]map[string]interface{}, error) {
	if namespace == "" || name == "" {
		return nil, ErrUncompleteParam
	}

	vlBase, err := logsQueryEndpointFromEnv()
	if err != nil {
		return nil, err
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create k8s client: %w", err)
	}

	// Get pod+container combinations
	podContainers, err := getAppPodsAndContainers(ctx, clientset, namespace, name)
	if err != nil {
		return nil, err
	}

	// Filter by container if specified
	var toQuery []podContainer
	var limit string
	if container != "" {
		for _, pc := range podContainers {
			if pc.container == container {
				toQuery = append(toQuery, pc)
			}
		}
		limit = defaultLogLimitSingle
	} else {
		toQuery = podContainers
		limit = defaultLogLimitAll
	}
	if opts.Limit != "" {
		limit = opts.Limit
	}

	var start, end string
	if opts.Start != "" && opts.End != "" {
		start, end = opts.Start, opts.End
	} else {
		start, end = defaultLogsRangeUnix()
	}

	// Query logs for each pod+container in parallel
	results := make(map[string][]map[string]interface{})
	var mu sync.Mutex
	var wg sync.WaitGroup
	var firstErr error

	for _, pc := range toQuery {
		wg.Add(1)
		go func(p podContainer) {
			defer wg.Done()

			query := composeAppLogsQL(namespace, p.pod, p.container, limit, opts.Search)
			logs, err := executeLogsQuery(ctx, vlBase, query, start, end)
			if err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				return
			}

			key := p.pod + "/" + p.container
			mu.Lock()
			results[key] = logs
			mu.Unlock()
		}(pc)
	}

	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}

	return results, nil
}

type podContainer struct {
	pod       string
	container string
}

// getAppPodsAndContainers finds pods whose app label equals or starts with name.
// Some imported Launchpad-style workloads use app={name}-{suffix}.
func getAppPodsAndContainers(ctx context.Context, clientset *kubernetes.Clientset, namespace, name string) ([]podContainer, error) {
	pods, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: appLabel,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	var result []podContainer
	prefix := name + "-"
	suffixedLen := len(name) + 5 // "{name}-{4char}"
	for _, pod := range pods.Items {
		v := pod.Labels[appLabel]
		if v == name || (len(v) == suffixedLen && strings.HasPrefix(v, prefix)) {
			for _, cs := range pod.Status.ContainerStatuses {
				result = append(result, podContainer{pod: pod.Name, container: cs.Name})
			}
		}
	}
	if len(result) == 0 {
		return nil, ErrNoPodsFound
	}
	return result, nil
}

// composeAppLogsQL builds a LogsQL query for app logs.
// Example: {namespace='ns-xxx',pod='pod1',container='app'} | limit '10' | sort by (_time) desc
func composeAppLogsQL(namespace, pod, container, limit, search string) string {
	parts := []string{
		fmt.Sprintf("{namespace='%s',pod='%s',container='%s'}",
			escapeLogsQLString(namespace),
			escapeLogsQLString(pod),
			escapeLogsQLString(container)),
	}
	if search != "" {
		parts = append(parts, fmt.Sprintf(`_msg:~"%s"`, escapeLogsQLRegex(search)))
	}
	parts = append(parts, "| limit '"+limit+"'", "| sort by (_time) desc")
	return strings.Join(parts, " ")
}

// QueryDBLogs queries VictoriaLogs for database logs.
// Finds pods by label app.kubernetes.io/instance=<name>,
// then queries logs for each container.
// If container is empty, queries all containers with limit 10 each.
// If container is specified, queries only that container with limit 50.
func QueryDBLogs(ctx context.Context, restConfig *rest.Config, namespace, name, container string, opts QueryOptions) (map[string][]map[string]interface{}, error) {
	if namespace == "" || name == "" {
		return nil, ErrUncompleteParam
	}

	vlBase, err := logsQueryEndpointFromEnv()
	if err != nil {
		return nil, err
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create k8s client: %w", err)
	}

	// Get pod names and container names
	podNames, allContainers, err := getPodsAndContainers(ctx, clientset, namespace, name)
	if err != nil {
		return nil, err
	}

	// Determine which containers to query and the limit
	var containersToQuery []string
	var limit string
	if container != "" {
		containersToQuery = []string{container}
		limit = defaultLogLimitSingle
	} else {
		containersToQuery = allContainers
		limit = defaultLogLimitAll
	}
	if opts.Limit != "" {
		limit = opts.Limit
	}

	var start, end string
	if opts.Start != "" && opts.End != "" {
		start, end = opts.Start, opts.End
	} else {
		start, end = defaultLogsRangeUnix()
	}

	// Query logs for each container in parallel
	results := make(map[string][]map[string]interface{})
	var mu sync.Mutex
	var wg sync.WaitGroup
	var firstErr error

	for _, c := range containersToQuery {
		wg.Add(1)
		go func(containerName string) {
			defer wg.Done()

			query := composeDBLogsQL(namespace, podNames, containerName, limit, opts.Search)
			logs, err := executeLogsQuery(ctx, vlBase, query, start, end)
			if err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				return
			}

			mu.Lock()
			results[containerName] = logs
			mu.Unlock()
		}(c)
	}

	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}

	return results, nil
}

// getPodsAndContainers finds pods with label app.kubernetes.io/instance=<name>
// and returns pod names and unique container names.
func getPodsAndContainers(ctx context.Context, clientset *kubernetes.Clientset, namespace, name string) ([]string, []string, error) {
	labelSelector := fmt.Sprintf("%s=%s", instanceLabel, name)
	pods, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list pods: %w", err)
	}
	if len(pods.Items) == 0 {
		return nil, nil, ErrNoPodsFound
	}

	podNames := make([]string, 0, len(pods.Items))
	containerSet := make(map[string]struct{})

	for _, pod := range pods.Items {
		podNames = append(podNames, pod.Name)
		for _, cs := range pod.Status.ContainerStatuses {
			containerSet[cs.Name] = struct{}{}
		}
	}

	containers := make([]string, 0, len(containerSet))
	for c := range containerSet {
		containers = append(containers, c)
	}
	return podNames, containers, nil
}

// composeDBLogsQL builds a LogsQL query for database logs.
// Example: {namespace='ns-xxx',pod=~'pod1|pod2'} container:='postgresql' | limit '10' | sort by (_time) desc
func composeDBLogsQL(namespace string, podNames []string, container, limit, search string) string {
	podPattern := strings.Join(podNames, "|")

	parts := []string{
		fmt.Sprintf("{namespace='%s',pod=~'%s'}", escapeLogsQLString(namespace), escapeLogsQLString(podPattern)),
		fmt.Sprintf("container:='%s'", escapeLogsQLString(container)),
	}
	if search != "" {
		parts = append(parts, fmt.Sprintf(`_msg:~"%s"`, escapeLogsQLRegex(search)))
	}
	parts = append(parts, "| limit '"+limit+"'", "| sort by (_time) desc")
	return strings.Join(parts, " ")
}

func logsQueryEndpointFromEnv() (string, error) {
	vlURL := os.Getenv("VLSELECT_URL")
	if vlURL == "" {
		return "", ErrNoVLHost
	}
	// Expect URL like http://127.0.0.1:8482/select/logsql/query
	return strings.TrimRight(vlURL, "/"), nil
}

func defaultLogsRangeUnix() (string, string) {
	now := time.Now().UTC()
	end := strconv.FormatInt(now.Unix(), 10)
	start := strconv.FormatInt(now.Add(-defaultLogsRangeMin*time.Minute).Unix(), 10)
	return start, end
}

func executeLogsQuery(ctx context.Context, baseURL, query, start, end string) ([]map[string]interface{}, error) {
	client := &http.Client{Timeout: 20 * time.Second}

	u, err := url.Parse(baseURL)
	if err != nil {
		return nil, err
	}
	values := u.Query()
	values.Set("query", query)
	values.Set("start", start)
	values.Set("end", end)
	u.RawQuery = values.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}

	// Add basic auth from vmauth secret or env vars
	username, password, err := getVmauthCredentials(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get vmauth credentials: %w", err)
	}
	if username != "" {
		req.SetBasicAuth(username, password)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("VictoriaLogs returned %s", resp.Status)
	}

	// VictoriaLogs returns NDJSON (newline-delimited JSON), parse each line
	results := make([]map[string]interface{}, 0)
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var entry map[string]interface{}
		if err := json.Unmarshal(line, &entry); err != nil {
			return nil, fmt.Errorf("failed to parse log entry: %w", err)
		}
		results = append(results, entry)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading response: %w", err)
	}

	return results, nil
}
