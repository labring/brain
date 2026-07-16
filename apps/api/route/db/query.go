package db

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

var kubeBlocksBackupGVR = schema.GroupVersionResource{
	Group:    "dataprotection.kubeblocks.io",
	Version:  "v1alpha1",
	Resource: "backups",
}

func registerGet(grp huma.API) {
	type dbGetInput struct {
		middleware.AuthInput
		LabelSelector string `query:"label-selector" doc:"Optional Kubernetes label selector appended to the Brain-managed DB selector"`
		Name          string `query:"name" doc:"DB instance name (omit to list all in namespace)"`
		Namespace     string `query:"namespace" doc:"Namespace (default from kubeconfig)"`
	}
	type dbGetOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-get",
		Method:      http.MethodGet,
		Path:        "/",
		Summary:     "Get DB(s)",
		Description: "Get a single DB by name or list DBs in the namespace.\n\nParameter usage:\n- `name` is optional. If omitted, the endpoint lists all Brain-managed DBs in the resolved namespace.\n- `namespace` is optional. Resolution order is explicit namespace, kubeconfig current-context namespace, then the route default.\n- `label-selector` is optional and is appended to the mandatory Brain DB selector.\n\nWhat the DB represents:\n- DB is a Brain product view backed by a KubeBlocks Cluster and related Kubernetes support resources.\n- `brain.io/project-id` is the project ownership boundary for list, canvas, and lifecycle operations.\n\nResponse:\n- Returns DB resource(s) with product-facing `spec` and `status.phase` adapted from the observed KubeBlocks Cluster.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbGetInput) (*dbGetOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			LabelSelector: dbClusterLabelSelector(input.LabelSelector),
			Resource:      "clusters",
			Name:          input.Name,
			Namespace:     resolved.Namespace,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("DB not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to get DB(s)", err)
		}
		body, err := dbResponseFromClustersWithSupport(cfg, jsonBytes, input.Name != "")
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("DB not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to adapt DB response", err)
		}
		return &dbGetOutput{Body: body}, nil
	})
}

func dbClusterLabelSelector(extra string) string {
	base := orchestration.DBProviderInstanceLabel + "," +
		orchestration.DBProviderClusterDefinitionLabel + "," +
		orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," +
		orchestration.BrainProjectIDLabel
	extra = strings.TrimSpace(extra)
	if extra == "" {
		return base
	}
	return base + "," + extra
}

func dbResponseFromClusters(jsonBytes []byte, single bool) (json.RawMessage, error) {
	if single {
		var cluster unstructured.Unstructured
		if err := json.Unmarshal(jsonBytes, &cluster); err != nil {
			return nil, err
		}
		if err := requireBrainDBLikeCluster(cluster); err != nil {
			return nil, apierrors.NewNotFound(schema.GroupResource{Group: "apps.kubeblocks.io", Resource: "clusters"}, cluster.GetName())
		}
		return json.Marshal(orchestration.DBObjectFromCluster(&cluster))
	}
	list, err := dbClusterListFromJSON(jsonBytes)
	if err != nil {
		return nil, err
	}
	items := make([]interface{}, 0, len(list.Items))
	for i := range list.Items {
		items = append(items, orchestration.DBObjectFromCluster(&list.Items[i]))
	}
	out := map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"items":      items,
		"kind":       "DBList",
	}
	return json.Marshal(out)
}

func dbResponseFromClustersWithSupport(cfg *clientcmdapi.Config, jsonBytes []byte, single bool) (json.RawMessage, error) {
	if cfg == nil {
		return dbResponseFromClusters(jsonBytes, single)
	}
	if single {
		var cluster unstructured.Unstructured
		if err := json.Unmarshal(jsonBytes, &cluster); err != nil {
			return nil, err
		}
		if err := requireBrainDBLikeCluster(cluster); err != nil {
			return nil, apierrors.NewNotFound(schema.GroupResource{Group: "apps.kubeblocks.io", Resource: "clusters"}, cluster.GetName())
		}
		db := orchestration.DBObjectFromCluster(&cluster)
		applyDBConnectionState(cfg, db, cluster.GetName(), cluster.GetNamespace())
		if backups, err := dbBackupsForCluster(cfg, &cluster); err != nil {
			return nil, err
		} else {
			applyDBBackupState(db, backups)
		}
		return json.Marshal(db)
	}
	list, err := dbClusterListFromJSON(jsonBytes)
	if err != nil {
		return nil, err
	}
	items := make([]interface{}, 0, len(list.Items))
	for i := range list.Items {
		db := orchestration.DBObjectFromCluster(&list.Items[i])
		applyDBConnectionState(cfg, db, list.Items[i].GetName(), list.Items[i].GetNamespace())
		if backups, err := dbBackupsForCluster(cfg, &list.Items[i]); err != nil {
			return nil, err
		} else {
			applyDBBackupState(db, backups)
		}
		items = append(items, db)
	}
	out := map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"items":      items,
		"kind":       "DBList",
	}
	return json.Marshal(out)
}

func dbClusterListFromJSON(jsonBytes []byte) (unstructured.UnstructuredList, error) {
	var list unstructured.UnstructuredList
	if err := json.Unmarshal(jsonBytes, &list); err == nil {
		return list, nil
	}

	var wrapped struct {
		Object map[string]interface{}   `json:"Object"`
		Items  []map[string]interface{} `json:"items"`
	}
	if err := json.Unmarshal(jsonBytes, &wrapped); err != nil {
		return list, err
	}
	if wrapped.Object == nil {
		return list, json.Unmarshal(jsonBytes, &list)
	}
	normalized := map[string]interface{}{}
	for key, value := range wrapped.Object {
		normalized[key] = value
	}
	items := make([]interface{}, 0, len(wrapped.Items))
	for _, item := range wrapped.Items {
		items = append(items, item)
	}
	normalized["items"] = items
	normalizedBytes, err := json.Marshal(normalized)
	if err != nil {
		return list, err
	}
	if err := json.Unmarshal(normalizedBytes, &list); err != nil {
		return list, err
	}
	return list, nil
}

func applyDBBackupState(db map[string]interface{}, backups []map[string]interface{}) {
	if db == nil {
		return
	}
	status, _ := db["status"].(map[string]interface{})
	if status == nil {
		status = map[string]interface{}{}
		db["status"] = status
	}
	status["backups"] = backups
}

func dbBackupsForCluster(cfg *clientcmdapi.Config, cluster *unstructured.Unstructured) ([]map[string]interface{}, error) {
	if cfg == nil ||
		cluster == nil ||
		cluster.GetUID() == "" ||
		cluster.GetNamespace() == "" {
		return nil, nil
	}
	restConfig, err := restConfigForDBRoute(cfg)
	if err != nil {
		return nil, err
	}
	client, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, err
	}
	list, err := client.Resource(kubeBlocksBackupGVR).Namespace(cluster.GetNamespace()).List(
		context.Background(),
		metav1.ListOptions{
			LabelSelector: orchestration.KubeBlocksBackupClusterUIDLabel + "=" + string(cluster.GetUID()),
		},
	)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]interface{}, 0, len(list.Items))
	for i := range list.Items {
		items = append(items, list.Items[i].Object)
	}
	return items, nil
}

func restConfigForDBRoute(cfg *clientcmdapi.Config) (*rest.Config, error) {
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		DefaultNamespace: "",
	})
	if err != nil {
		return nil, err
	}
	return resolved.RestConfig, nil
}

func applyDBConnectionState(cfg *clientcmdapi.Config, db map[string]interface{}, name string, namespace string) {
	if db == nil || name == "" || namespace == "" {
		return
	}
	export, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		Name:      name + "-export",
		Namespace: namespace,
		Resource:  "services",
	})
	enabled := err == nil
	spec, _ := db["spec"].(map[string]interface{})
	if spec == nil {
		spec = map[string]interface{}{}
		db["spec"] = spec
	}
	spec["exposeNodePort"] = enabled
	status, _ := db["status"].(map[string]interface{})
	if status == nil {
		status = map[string]interface{}{}
		db["status"] = status
	}
	secret := dbConnectionSecret(cfg, name, namespace)
	status["variables"] = dbVariablesFromSecret(db, secret)
	// Read paths carry credential-free DB Connection Templates: the credential
	// Secret's username and password keys are never decoded here (ADR-0052).
	// The complete DB Connection DSN is served only by the reveal route.
	database := dbDatabaseNameFromSecret(secret)
	if privateTemplate := dbConnectionTemplate(db, dbPrivateConnectionAddress(db, name, namespace), database); privateTemplate != "" {
		status["connectionStringPrivate"] = privateTemplate
	}
	if !enabled {
		return
	}
	var service map[string]interface{}
	if err := json.Unmarshal(export, &service); err != nil {
		return
	}
	if nodePort := firstServiceNodePort(service); nodePort > 0 {
		status["nodePort"] = nodePort
		if publicTemplate := dbConnectionTemplate(db, dbPublicConnectionAddress(nodePort), database); publicTemplate != "" {
			status["connectionStringPublic"] = publicTemplate
		}
	}
}

type dbConnectionCredentials struct {
	database string
	password string
	username string
}

func dbPrivateConnectionAddress(db map[string]interface{}, name string, namespace string) string {
	profile := dbEngineProfileFromDBObject(db)
	hostName := name
	if strings.TrimSpace(profile.ComponentName) != "" {
		hostName = name + "-" + profile.ComponentName
	}
	host := hostName + "." + namespace + ".svc"
	return netAddress(host, profile.ServicePort)
}

func dbPublicConnectionAddress(nodePort int64) string {
	if nodePort <= 0 {
		return ""
	}
	host := strings.TrimSpace(os.Getenv("DB_PUBLIC_HOST"))
	if host == "" {
		return ":" + strconv.FormatInt(nodePort, 10)
	}
	host = strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://")
	host = strings.TrimRight(host, "/")
	return netAddress(host, int32(nodePort))
}

func dbConnectionSecret(cfg *clientcmdapi.Config, name string, namespace string) *unstructured.Unstructured {
	if cfg == nil {
		return nil
	}
	secrets, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		LabelSelector: orchestration.DBProviderInstanceLabel + "=" + name,
		Namespace:     namespace,
		Resource:      "secrets",
	})
	if err != nil {
		return nil
	}
	var list unstructured.UnstructuredList
	if err := json.Unmarshal(secrets, &list); err != nil || len(list.Items) == 0 {
		return nil
	}
	secret := shortestNamedSecret(list.Items)
	return &secret
}

func shortestNamedSecret(items []unstructured.Unstructured) unstructured.Unstructured {
	best := items[0]
	for _, item := range items[1:] {
		if item.GetName() != "" && (best.GetName() == "" || len(item.GetName()) < len(best.GetName())) {
			best = item
		}
	}
	return best
}

func dbVariablesFromSecret(db map[string]interface{}, secret *unstructured.Unstructured) []map[string]interface{} {
	if secret == nil {
		return nil
	}
	data, _ := secret.Object["data"].(map[string]interface{})
	if len(data) == 0 {
		data, _ = secret.Object["stringData"].(map[string]interface{})
	}
	if len(data) == 0 {
		return nil
	}
	secretName := strings.TrimSpace(secret.GetName())
	if secretName == "" {
		return nil
	}
	keys := make([]string, 0, len(data))
	for key := range data {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	keys = orderedDBSecretKeys(keys)
	prefix := dbEnvPrefix(dbEngineProfileFromDBObject(db).Engine)
	variables := make([]map[string]interface{}, 0, len(keys))
	for _, key := range keys {
		variables = append(variables, map[string]interface{}{
			"name": prefix + "_" + dbEnvKey(key),
			"valueFrom": map[string]interface{}{
				"secretKeyRef": map[string]interface{}{
					"key":  key,
					"name": secretName,
				},
			},
		})
	}
	return variables
}

// dbConnectionCredentialsFromSecret decodes the credential Secret for reveal
// responses only; DB read paths use dbDatabaseNameFromSecret instead so the
// username and password keys stay undecoded there (ADR-0052).
func dbConnectionCredentialsFromSecret(secret *unstructured.Unstructured) dbConnectionCredentials {
	return dbConnectionCredentials{
		database: dbDecodedSecretValue(secret, "database", "dbname", "databaseName"),
		password: dbDecodedSecretValue(secret, "password", "passwd"),
		username: dbDecodedSecretValue(secret, "username", "user"),
	}
}

// dbDatabaseNameFromSecret reads the database name (not a credential) from the
// credential Secret without decoding any other key.
func dbDatabaseNameFromSecret(secret *unstructured.Unstructured) string {
	return dbDecodedSecretValue(secret, "database", "dbname", "databaseName")
}

func dbDecodedSecretValue(secret *unstructured.Unstructured, keys ...string) string {
	if secret == nil {
		return ""
	}
	data, _ := secret.Object["data"].(map[string]interface{})
	stringData, _ := secret.Object["stringData"].(map[string]interface{})
	for _, key := range keys {
		if text, ok := stringData[key].(string); ok && text != "" {
			return text
		}
		encoded, ok := data[key].(string)
		if !ok || encoded == "" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return encoded
		}
		return string(decoded)
	}
	return ""
}

func orderedDBSecretKeys(keys []string) []string {
	preferred := []string{"host", "endpoint", "port", "username", "user", "password", "passwd"}
	seen := map[string]bool{}
	out := make([]string, 0, len(keys))
	for _, preferredKey := range preferred {
		for _, key := range keys {
			if key == preferredKey && !seen[key] {
				out = append(out, key)
				seen[key] = true
			}
		}
	}
	for _, key := range keys {
		if !seen[key] {
			out = append(out, key)
			seen[key] = true
		}
	}
	return out
}

func dbEnvPrefix(engine string) string {
	engine = strings.ToUpper(strings.TrimSpace(engine))
	engine = strings.ReplaceAll(engine, "-", "_")
	if engine == "" {
		return "DB"
	}
	return engine
}

func dbEnvKey(key string) string {
	key = strings.ToUpper(strings.TrimSpace(key))
	key = strings.ReplaceAll(key, "-", "_")
	key = strings.ReplaceAll(key, ".", "_")
	if key == "" {
		return "VALUE"
	}
	return key
}

// dbConnectionTemplateUserInfo is the literal userinfo a DB Connection
// Template carries instead of decoded credentials. `<` and `>` are invalid in
// URL userinfo, so a template pasted unmodified into an application fails at
// connection-string parse time rather than at authentication (ADR-0052).
const dbConnectionTemplateUserInfo = "<username>:<password>"

// dbConnectionTemplate composes the credential-free DB Connection Template for
// DB read responses: placeholder userinfo, real address and database name.
// Composed by string concatenation because url.URL would percent-encode the
// placeholder brackets.
func dbConnectionTemplate(db map[string]interface{}, address string, database string) string {
	address = strings.TrimSpace(address)
	if address == "" {
		return ""
	}
	profile := dbEngineProfileFromDBObject(db)
	switch profile.Engine {
	case "postgresql", "mysql", "mongodb":
		database = strings.TrimSpace(database)
		if database == "" {
			database = profile.DefaultDatabase
		}
		return profile.Engine + "://" + dbConnectionTemplateUserInfo + "@" + address + dbConnectionPath(database)
	case "redis":
		return profile.Engine + "://" + dbConnectionTemplateUserInfo + "@" + address + dbConnectionPath("")
	default:
		return address
	}
}

func dbConnectionString(db map[string]interface{}, address string, credentials ...dbConnectionCredentials) string {
	address = strings.TrimSpace(address)
	if address == "" {
		return ""
	}
	profile := dbEngineProfileFromDBObject(db)
	credential := dbConnectionCredentials{}
	if len(credentials) > 0 {
		credential = credentials[0]
	}
	database := strings.TrimSpace(credential.database)
	if database == "" {
		database = profile.DefaultDatabase
	}
	switch profile.Engine {
	case "postgresql":
		return dbConnectionURL("postgresql", address, database, credential, false)
	case "mysql":
		return dbConnectionURL("mysql", address, database, credential, false)
	case "mongodb":
		return dbConnectionURL("mongodb", address, database, credential, false)
	case "redis":
		return dbConnectionURL("redis", address, "", credential, true)
	default:
		return address
	}
}

func dbConnectionURL(scheme string, address string, database string, credential dbConnectionCredentials, allowPasswordOnly bool) string {
	u := url.URL{
		Scheme: scheme,
		Host:   address,
		Path:   dbConnectionPath(database),
	}
	username := credential.username
	password := credential.password
	if username != "" && password != "" {
		u.User = url.UserPassword(username, password)
	} else if allowPasswordOnly && password != "" {
		u.User = url.UserPassword("", password)
	}
	return u.String()
}

func dbConnectionPath(database string) string {
	database = strings.TrimSpace(database)
	if database == "" {
		return "/"
	}
	return "/" + url.PathEscape(database)
}

func dbEngineProfileFromDBObject(db map[string]interface{}) orchestration.DBEngineProfile {
	spec, _ := db["spec"].(map[string]interface{})
	engine, _ := spec["engine"].(string)
	if profile, ok := orchestration.DBEngineProfileFor(engine); ok {
		return profile
	}
	return orchestration.DBEngineProfile{ServicePort: 5432}
}

func netAddress(host string, port int32) string {
	host = strings.TrimSpace(host)
	if host == "" || port <= 0 {
		return host
	}
	return host + ":" + strconv.FormatInt(int64(port), 10)
}

func firstServiceNodePort(service map[string]interface{}) int64 {
	spec, _ := service["spec"].(map[string]interface{})
	ports, _ := spec["ports"].([]interface{})
	for _, item := range ports {
		port, _ := item.(map[string]interface{})
		switch value := port["nodePort"].(type) {
		case int64:
			return value
		case int:
			return int64(value)
		case float64:
			return int64(value)
		}
	}
	return 0
}
