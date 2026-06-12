package ap

import (
	"crypto/sha256"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"sealos/api/service/orchestration"
)

// defaultIngressHostPlaceholder is a placeholder from older generated templates.
// It must not surface as a real connection URL.
const defaultIngressHostPlaceholder = "placeholder.example.com"

var platformAddressIDPattern = regexp.MustCompile(`^pa_[a-z0-9]{6,32}$`)
var platformAddressDomainPrefixPattern = regexp.MustCompile(`^[a-z]{6}$`)
var customDomainBindingIDPattern = regexp.MustCompile(`^cd_[a-z0-9]{6,32}$`)

const platformAddressHostAlphabet = "abcdefghijklmnopqrstuvwxyz"

func isPlaceholderIngressHost(host string) bool {
	h := strings.TrimSpace(strings.ToLower(host))
	if h == defaultIngressHostPlaceholder {
		return true
	}
	suffix := "." + defaultIngressHostPlaceholder
	return strings.HasSuffix(h, suffix)
}

// APWithIngressesServicesAndBackups extends APWithIngressesAndServicesFromList with status.backups (snapshot summaries).
func APWithIngressesServicesAndBackups(ap map[string]interface{}, ingresses, services []map[string]interface{}, backups []map[string]interface{}) map[string]interface{} {
	out := APWithIngressesAndServicesFromList(ap, ingresses, services)
	if out == nil || len(backups) == 0 {
		return out
	}
	status, _ := out["status"].(map[string]interface{})
	if status != nil {
		status["backups"] = backups
	}
	return out
}

// APWithPublicAccessSupportResourcesFromList enriches AP public access health
// from AP-owned public routing support resources.
func APWithPublicAccessSupportResourcesFromList(ap map[string]interface{}, ingresses, services, certificates, issuers []map[string]interface{}) map[string]interface{} {
	out := APWithIngressesAndServicesFromList(ap, ingresses, services)
	if out == nil {
		return nil
	}
	status, _ := out["status"].(map[string]interface{})
	if status == nil {
		status = map[string]interface{}{}
		out["status"] = status
	}
	mergePublicAccessSupportHealth(out, status, ingresses, certificates, issuers)
	return out
}

// APWithIngressesAndServicesFromList takes an AP resource (as raw map), lists of ingresses and services,
// and enriches status.network from spec.input.network when the cluster has not written it yet.
// It keeps the older status.variables table populated from observed Service/Ingress state only.
func APWithIngressesAndServicesFromList(ap map[string]interface{}, ingresses, services []map[string]interface{}) map[string]interface{} {
	if ap == nil {
		return nil
	}
	// Shallow copy to avoid mutating the original
	out := make(map[string]interface{})
	for k, v := range ap {
		out[k] = v
	}

	// Ensure status exists and copy it to avoid mutating the original
	status, _ := out["status"].(map[string]interface{})
	if status == nil {
		status = make(map[string]interface{})
	}
	statusCopy := make(map[string]interface{})
	for k, v := range status {
		statusCopy[k] = v
	}
	connectionRows := buildConnectionRows(ap, ingresses, services)
	if variables := buildVariablesFromConnectionRows(connectionRows); len(variables) > 0 {
		statusCopy["variables"] = variables
	} else {
		delete(statusCopy, "variables")
	}
	mergePrivateNetworkStatus(ap, statusCopy, services)
	mergePublicNetworkStatus(ap, statusCopy)
	mergeObservedPublicAccessStatus(statusCopy, ingresses, services)
	out["status"] = statusCopy

	return out
}

func mergePrivateNetworkStatus(ap map[string]interface{}, status map[string]interface{}, services []map[string]interface{}) {
	appListeningPorts := apAppListeningPorts(ap)
	if len(appListeningPorts) == 0 {
		return
	}
	privatePort := appListeningPorts[0]

	networkCopy := networkStatusCopy(status)
	if _, exists := networkCopy["privatePort"]; !exists {
		networkCopy["privatePort"] = privatePort
	}
	if _, exists := networkCopy["privateAddress"]; !exists {
		apNamespace := getString(ap, "metadata", "namespace")
		if addr := privateNetworkAddressForPort(services, apNamespace, privatePort); addr != "" {
			networkCopy["privateAddress"] = addr
		}
	}
	if _, exists := networkCopy["appListeningPorts"]; !exists {
		apNamespace := getString(ap, "metadata", "namespace")
		rows := make([]interface{}, 0, len(appListeningPorts))
		for _, port := range appListeningPorts {
			row := map[string]interface{}{"port": port}
			if addr := privateNetworkAddressForPort(services, apNamespace, port); addr != "" {
				row["privateAddress"] = addr
			}
			rows = append(rows, row)
		}
		networkCopy["appListeningPorts"] = rows
	}
	status["network"] = networkCopy
}

func networkStatusCopy(status map[string]interface{}) map[string]interface{} {
	network, _ := status["network"].(map[string]interface{})
	networkCopy := make(map[string]interface{}, len(network)+1)
	for k, v := range network {
		networkCopy[k] = v
	}
	return networkCopy
}

func apInputNetwork(ap map[string]interface{}) map[string]interface{} {
	spec, _ := ap["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	network, _ := input["network"].(map[string]interface{})
	return network
}

func apPrivatePort(ap map[string]interface{}) (int, bool) {
	appListeningPorts := apAppListeningPorts(ap)
	if len(appListeningPorts) > 0 {
		return appListeningPorts[0], true
	}
	network := apInputNetwork(ap)
	if network == nil {
		return 0, false
	}
	return privatePortFromValue(network["privatePort"])
}

func apAppListeningPorts(ap map[string]interface{}) []int {
	network := apInputNetwork(ap)
	if network == nil {
		return nil
	}
	if raw, ok := network["appListeningPorts"].([]interface{}); ok {
		out := make([]int, 0, len(raw))
		seen := make(map[int]bool, len(raw))
		for _, item := range raw {
			row, _ := item.(map[string]interface{})
			if row == nil {
				return nil
			}
			port, ok := privatePortFromValue(row["port"])
			if !ok || seen[port] {
				return nil
			}
			seen[port] = true
			out = append(out, port)
		}
		if len(out) > 0 {
			return out
		}
		return nil
	}
	if port, ok := privatePortFromValue(network["privatePort"]); ok {
		return []int{port}
	}
	return nil
}

func privateNetworkAddressForPort(services []map[string]interface{}, namespace string, privatePort int) string {
	for _, svc := range services {
		svcName := getString(svc, "metadata", "name")
		if svcName == "" {
			continue
		}
		svcNamespace := getString(svc, "metadata", "namespace")
		if svcNamespace == "" {
			svcNamespace = namespace
		}
		if svcNamespace == "" {
			continue
		}
		for _, port := range getPorts(svc) {
			if port != privatePort {
				continue
			}
			if privatePort == 80 {
				return fmt.Sprintf("http://%s.%s.svc.cluster.local", svcName, svcNamespace)
			}
			return fmt.Sprintf("http://%s.%s.svc.cluster.local:%d", svcName, svcNamespace, privatePort)
		}
	}
	return ""
}

type platformAddressRequest struct {
	domainPrefix string
	id           string
	port         int
}

type customDomainRequest struct {
	domain            string
	dnsStatus         string
	dnsTarget         string
	dnsVerifiedAt     string
	id                string
	platformAddressID string
}

func mergePublicNetworkStatus(ap map[string]interface{}, status map[string]interface{}) {
	platformAddresses := apPlatformAddressRequests(ap)
	if len(platformAddresses) == 0 {
		removePublicNetworkStatus(status)
		return
	}
	customDomains := apCustomDomainRequests(ap, platformAddresses)
	appListeningPortSet := apAppListeningPortSet(ap)
	networkCopy := networkStatusCopy(status)
	if _, exists := networkCopy["publicAddresses"]; exists {
		publicAddresses := publicAddressRowsForIntent(
			publicAddressRowsFromValue(networkCopy["publicAddresses"]),
			platformAddresses,
			customDomains,
		)
		seenIDs, promotedPlatformAddressIDs := publicAddressMergeState(publicAddresses)
		for _, customDomain := range customDomains {
			if seenIDs[customDomain.id] {
				promotedPlatformAddressIDs[customDomain.platformAddressID] = true
				continue
			}
			row := pendingCustomDomainRow(ap, platformAddresses, customDomain, appListeningPortSet)
			if row == nil {
				continue
			}
			publicAddresses = append(publicAddresses, row)
			seenIDs[customDomain.id] = true
			promotedPlatformAddressIDs[customDomain.platformAddressID] = true
		}
		publicAddresses = hidePromotedPlatformAddressRows(publicAddresses, promotedPlatformAddressIDs)
		for _, address := range platformAddresses {
			if seenIDs[address.id] || promotedPlatformAddressIDs[address.id] {
				continue
			}
			publicAddresses = append(publicAddresses, pendingPublicAddressRow(ap, address, appListeningPortSet))
		}
		networkCopy["publicAddresses"] = canonicalPublicAddressRows(publicAddresses)
		status["network"] = networkCopy
		return
	}

	promotedPlatformAddressIDs := make(map[string]bool)
	publicAddresses := make([]map[string]interface{}, 0, len(platformAddresses)+len(customDomains))
	for _, customDomain := range customDomains {
		row := pendingCustomDomainRow(ap, platformAddresses, customDomain, appListeningPortSet)
		if row == nil {
			continue
		}
		publicAddresses = append(publicAddresses, row)
		promotedPlatformAddressIDs[customDomain.platformAddressID] = true
	}
	for _, address := range platformAddresses {
		if promotedPlatformAddressIDs[address.id] {
			continue
		}
		publicAddresses = append(publicAddresses, pendingPublicAddressRow(ap, address, appListeningPortSet))
	}
	networkCopy["publicAddresses"] = canonicalPublicAddressRows(publicAddresses)
	status["network"] = networkCopy
}

func removePublicNetworkStatus(status map[string]interface{}) {
	networkCopy := networkStatusCopy(status)
	if _, exists := networkCopy["publicAddresses"]; !exists {
		return
	}
	delete(networkCopy, "publicAddresses")
	if len(networkCopy) == 0 {
		delete(status, "network")
		return
	}
	status["network"] = networkCopy
}

func mergeObservedPublicAccessStatus(status map[string]interface{}, ingresses, services []map[string]interface{}) {
	if len(ingresses) == 0 || len(services) == 0 {
		return
	}
	networkCopy := networkStatusCopy(status)
	if len(publicAddressRowsFromValue(networkCopy["publicAddresses"])) > 0 {
		return
	}
	serviceNames := make(map[string]bool, len(services))
	servicePorts := make(map[string]map[int]bool, len(services))
	for _, service := range services {
		name := strings.TrimSpace(getString(service, "metadata", "name"))
		if name == "" {
			continue
		}
		serviceNames[name] = true
		ports := make(map[int]bool)
		for _, port := range getPorts(service) {
			ports[port] = true
		}
		servicePorts[name] = ports
	}
	rows := observedPublicAddressRows(ingresses, serviceNames, servicePorts)
	if len(rows) == 0 {
		return
	}
	networkCopy["publicAddresses"] = rows
	status["network"] = networkCopy
}

func observedPublicAddressRows(ingresses []map[string]interface{}, serviceNames map[string]bool, servicePorts map[string]map[int]bool) []map[string]interface{} {
	rows := []map[string]interface{}{}
	seen := map[string]bool{}
	for _, ingress := range ingresses {
		spec, _ := ingress["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		lbHost := getLoadBalancerHost(ingress)
		tlsHosts := getTLSHosts(spec)
		rules, _ := spec["rules"].([]interface{})
		for _, ruleItem := range rules {
			rule, _ := ruleItem.(map[string]interface{})
			if rule == nil {
				continue
			}
			host := strings.TrimSpace(getString(rule, "host"))
			if host == "" {
				host = lbHost
			}
			if host == "" || isPlaceholderIngressHost(host) {
				continue
			}
			paths, _ := getSlice(rule, "http", "paths")
			for _, pathItem := range paths {
				path, _ := pathItem.(map[string]interface{})
				if path == nil {
					continue
				}
				service, _ := getMap(path, "backend", "service")
				serviceName := strings.TrimSpace(getString(service, "name"))
				if !serviceNames[serviceName] {
					continue
				}
				port := publicAddressBackendPort(service)
				if port <= 0 || (len(servicePorts[serviceName]) > 0 && !servicePorts[serviceName][port]) {
					continue
				}
				pathValue := strings.TrimSpace(getString(path, "path"))
				if pathValue == "" {
					pathValue = "/"
				}
				if !strings.HasPrefix(pathValue, "/") {
					pathValue = "/" + pathValue
				}
				scheme := "http"
				if tlsHosts[host] {
					scheme = "https"
				}
				key := fmt.Sprintf("%s|%s|%d|%s", host, serviceName, port, pathValue)
				if seen[key] {
					continue
				}
				seen[key] = true
				rows = append(rows, map[string]interface{}{
					"host":   host,
					"id":     "observed-" + stablePlatformAddressHostLabel(key, 12),
					"port":   port,
					"status": "accessible",
					"type":   "observed",
					"url":    fmt.Sprintf("%s://%s%s", scheme, host, pathValue),
				})
			}
		}
	}
	return rows
}

func publicAddressRowsFromValue(value interface{}) []map[string]interface{} {
	switch rows := value.(type) {
	case []map[string]interface{}:
		out := make([]map[string]interface{}, 0, len(rows))
		for _, row := range rows {
			out = append(out, copyPublicAddressRow(row))
		}
		return out
	case []interface{}:
		out := make([]map[string]interface{}, 0, len(rows))
		for _, item := range rows {
			row, _ := item.(map[string]interface{})
			if row == nil {
				continue
			}
			out = append(out, copyPublicAddressRow(row))
		}
		return out
	default:
		return nil
	}
}

func publicAddressRowsForIntent(rows []map[string]interface{}, platformAddresses []platformAddressRequest, customDomains []customDomainRequest) []map[string]interface{} {
	if len(rows) == 0 {
		return rows
	}
	intentIDs := publicAddressIntentIDs(platformAddresses, customDomains)
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		id, _ := row["id"].(string)
		id = strings.TrimSpace(id)
		if id == "" || !intentIDs[id] {
			continue
		}
		out = append(out, row)
	}
	return out
}

func publicAddressIntentIDs(platformAddresses []platformAddressRequest, customDomains []customDomainRequest) map[string]bool {
	ids := make(map[string]bool, len(platformAddresses)+len(customDomains))
	for _, address := range platformAddresses {
		ids[address.id] = true
	}
	for _, domain := range customDomains {
		ids[domain.id] = true
	}
	return ids
}

func apAppListeningPortSet(ap map[string]interface{}) map[int]bool {
	ports := apAppListeningPorts(ap)
	out := make(map[int]bool, len(ports))
	for _, port := range ports {
		out[port] = true
	}
	return out
}

func copyPublicAddressRow(row map[string]interface{}) map[string]interface{} {
	rowCopy := make(map[string]interface{}, len(row))
	for k, v := range row {
		rowCopy[k] = v
	}
	return rowCopy
}

func publicAddressMergeState(rows []map[string]interface{}) (map[string]bool, map[string]bool) {
	seenIDs := make(map[string]bool, len(rows))
	promotedPlatformAddressIDs := make(map[string]bool)
	for _, row := range rows {
		id, _ := row["id"].(string)
		if id != "" {
			seenIDs[id] = true
		}
		platformAddressID, _ := row["platformAddressId"].(string)
		platformAddressID = strings.TrimSpace(platformAddressID)
		if platformAddressIDPattern.MatchString(platformAddressID) {
			promotedPlatformAddressIDs[platformAddressID] = true
		}
	}
	return seenIDs, promotedPlatformAddressIDs
}

func hidePromotedPlatformAddressRows(rows []map[string]interface{}, promotedPlatformAddressIDs map[string]bool) []map[string]interface{} {
	if len(promotedPlatformAddressIDs) == 0 {
		return rows
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		id, _ := row["id"].(string)
		if promotedPlatformAddressIDs[id] && !isCustomPublicAddressRow(row) {
			continue
		}
		out = append(out, row)
	}
	return out
}

func isCustomPublicAddressRow(row map[string]interface{}) bool {
	rowType, _ := row["type"].(string)
	return strings.ToLower(strings.TrimSpace(rowType)) == "custom"
}

func canonicalPublicAddressRows(rows []map[string]interface{}) []map[string]interface{} {
	for _, row := range rows {
		status, _ := row["status"].(string)
		if strings.TrimSpace(strings.ToLower(status)) != "pending" {
			continue
		}
		if isCustomPublicAddressRow(row) {
			row["status"] = "verifying"
		} else {
			row["status"] = "progressing"
		}
	}
	return rows
}

func pendingPublicAddressRow(ap map[string]interface{}, address platformAddressRequest, appListeningPortSet map[int]bool) map[string]interface{} {
	row := map[string]interface{}{
		"id":   address.id,
		"port": address.port,
		"type": "platform",
	}
	host := platformAddressHost(
		getString(ap, "metadata", "namespace"),
		getString(ap, "metadata", "name"),
		address.id,
		address.domainPrefix,
		apRoutingDomain(ap),
	)
	if host == "" {
		if publicAddressTargetPortMissing(address.port, appListeningPortSet) {
			row["reason"] = "target-port-missing"
			row["status"] = "blocked"
		} else {
			row["status"] = "progressing"
		}
		return row
	}
	row["host"] = host
	row["url"] = fmt.Sprintf("https://%s/", host)
	if publicAddressTargetPortMissing(address.port, appListeningPortSet) {
		row["reason"] = "target-port-missing"
		row["status"] = "blocked"
	} else {
		row["status"] = "progressing"
	}
	return row
}

func pendingCustomDomainRow(
	ap map[string]interface{},
	platformAddresses []platformAddressRequest,
	customDomain customDomainRequest,
	appListeningPortSet map[int]bool,
) map[string]interface{} {
	target, ok := platformAddressRequestByID(platformAddresses, customDomain.platformAddressID)
	if !ok {
		return nil
	}
	row := map[string]interface{}{
		"host":              customDomain.domain,
		"id":                customDomain.id,
		"platformAddressId": customDomain.platformAddressID,
		"port":              target.port,
		"type":              "custom",
		"url":               fmt.Sprintf("https://%s/", customDomain.domain),
	}
	cnameTarget := platformAddressHost(
		getString(ap, "metadata", "namespace"),
		getString(ap, "metadata", "name"),
		customDomain.platformAddressID,
		target.domainPrefix,
		apRoutingDomain(ap),
	)
	if cnameTarget != "" {
		row["cnameTarget"] = cnameTarget
	}
	if publicAddressTargetPortMissing(target.port, appListeningPortSet) {
		row["reason"] = "target-port-missing"
		row["status"] = "blocked"
	} else {
		row["status"] = "verifying"
	}
	return row
}

func publicAddressTargetPortMissing(port int, appListeningPortSet map[int]bool) bool {
	if len(appListeningPortSet) == 0 {
		return false
	}
	return !appListeningPortSet[port]
}

func platformAddressRequestByID(addresses []platformAddressRequest, id string) (platformAddressRequest, bool) {
	for _, address := range addresses {
		if address.id == id {
			return address, true
		}
	}
	return platformAddressRequest{}, false
}

func apPlatformAddressRequests(ap map[string]interface{}) []platformAddressRequest {
	network := apInputNetwork(ap)
	if network == nil {
		return nil
	}
	raw, _ := network["platformAddresses"].([]interface{})
	if len(raw) == 0 {
		return nil
	}
	addresses := make([]platformAddressRequest, 0, len(raw))
	for _, item := range raw {
		address, _ := item.(map[string]interface{})
		if address == nil {
			continue
		}
		id, _ := address["id"].(string)
		id = strings.TrimSpace(id)
		port, ok := privatePortFromValue(address["port"])
		if !platformAddressIDPattern.MatchString(id) || !ok {
			continue
		}
		domainPrefix, _ := address["domainPrefix"].(string)
		addresses = append(addresses, platformAddressRequest{
			domainPrefix: strings.TrimSpace(strings.ToLower(domainPrefix)),
			id:           id,
			port:         port,
		})
	}
	return addresses
}

func apCustomDomainRequests(ap map[string]interface{}, platformAddresses []platformAddressRequest) []customDomainRequest {
	network := apInputNetwork(ap)
	if network == nil {
		return nil
	}
	raw, _ := network["customDomains"].([]interface{})
	if len(raw) == 0 {
		return nil
	}
	platformAddressIDs := platformAddressIDSet(platformAddresses)
	customDomains := make([]customDomainRequest, 0, len(raw))
	for _, item := range raw {
		customDomain, _ := item.(map[string]interface{})
		if customDomain == nil {
			continue
		}
		id, _ := customDomain["id"].(string)
		id = strings.TrimSpace(id)
		domain, _ := customDomain["domain"].(string)
		domain = strings.Trim(strings.ToLower(strings.TrimSpace(domain)), ".")
		platformAddressID, _ := customDomain["platformAddressId"].(string)
		platformAddressID = strings.TrimSpace(platformAddressID)
		if !customDomainBindingIDPattern.MatchString(id) || domain == "" || !platformAddressIDs[platformAddressID] {
			continue
		}
		dns, _ := customDomain["dns"].(map[string]interface{})
		dnsStatus := strings.TrimSpace(strings.ToLower(getString(dns, "status")))
		dnsTarget := strings.TrimSpace(getString(dns, "target"))
		dnsVerifiedAt := strings.TrimSpace(getString(dns, "verifiedAt"))
		customDomains = append(customDomains, customDomainRequest{
			domain:            domain,
			dnsStatus:         dnsStatus,
			dnsTarget:         dnsTarget,
			dnsVerifiedAt:     dnsVerifiedAt,
			id:                id,
			platformAddressID: platformAddressID,
		})
	}
	return customDomains
}

type publicAccessSupportState struct {
	platformIngresses map[string]map[string]interface{}
	customIngresses   map[string]map[string]interface{}
	certificates      map[string]map[string]interface{}
}

const (
	brainDeploymentKindLabel = "brain.io/deployment-kind"
	brainDeploymentNameLabel = "brain.io/deployment-name"
	directAPDeploymentKind   = "ap"
	publicAddressIDLabel     = "brain.io/public-address-id"
	publicAddressKindLabel   = "brain.io/public-address-kind"
)

func mergePublicAccessSupportHealth(ap map[string]interface{}, status map[string]interface{}, ingresses, certificates, issuers []map[string]interface{}) {
	platformAddresses := apPlatformAddressRequests(ap)
	if len(platformAddresses) == 0 {
		return
	}
	customDomains := apCustomDomainRequests(ap, platformAddresses)
	appListeningPortSet := apAppListeningPortSet(ap)
	networkCopy := networkStatusCopy(status)
	publicAddresses := publicAddressRowsFromValue(networkCopy["publicAddresses"])
	if len(publicAddresses) == 0 {
		mergePublicNetworkStatus(ap, status)
		networkCopy = networkStatusCopy(status)
		publicAddresses = publicAddressRowsFromValue(networkCopy["publicAddresses"])
	}

	rowsByID := make(map[string]map[string]interface{}, len(publicAddresses))
	for _, row := range publicAddresses {
		id, _ := row["id"].(string)
		if id != "" {
			rowsByID[id] = row
		}
	}

	apName := getString(ap, "metadata", "name")
	namespace := getString(ap, "metadata", "namespace")
	serviceName := orchestration.APServiceName(apName)
	support := publicAccessSupportStateFromResources(apName, ingresses, certificates)
	promotedPlatformAddressIDs := make(map[string]bool, len(customDomains))

	for _, customDomain := range customDomains {
		target, ok := platformAddressRequestByID(platformAddresses, customDomain.platformAddressID)
		if !ok {
			continue
		}
		row := rowsByID[customDomain.id]
		if row == nil {
			row = pendingCustomDomainRow(ap, platformAddresses, customDomain, appListeningPortSet)
			if row == nil {
				continue
			}
			publicAddresses = append(publicAddresses, row)
			rowsByID[customDomain.id] = row
		}
		projectCustomDomainSupportHealth(row, ap, namespace, serviceName, target, customDomain, appListeningPortSet, support)
		promotedPlatformAddressIDs[customDomain.platformAddressID] = true
	}

	publicAddresses = hidePromotedPlatformAddressRows(publicAddresses, promotedPlatformAddressIDs)
	rowsByID = make(map[string]map[string]interface{}, len(publicAddresses))
	for _, row := range publicAddresses {
		id, _ := row["id"].(string)
		if id != "" {
			rowsByID[id] = row
		}
	}

	for _, address := range platformAddresses {
		if promotedPlatformAddressIDs[address.id] {
			continue
		}
		row := rowsByID[address.id]
		if row == nil {
			row = pendingPublicAddressRow(ap, address, appListeningPortSet)
			publicAddresses = append(publicAddresses, row)
			rowsByID[address.id] = row
		}
		projectPlatformAddressSupportHealth(row, ap, namespace, serviceName, address, appListeningPortSet, support)
	}

	networkCopy["publicAddresses"] = canonicalPublicAddressRows(publicAddresses)
	status["network"] = networkCopy
}

func publicAccessSupportStateFromResources(apName string, ingresses, certificates []map[string]interface{}) publicAccessSupportState {
	state := publicAccessSupportState{
		platformIngresses: make(map[string]map[string]interface{}),
		customIngresses:   make(map[string]map[string]interface{}),
		certificates:      make(map[string]map[string]interface{}),
	}
	for _, ingress := range ingresses {
		labels := labelsOf(ingress)
		if !isPublicAccessSupportForAP(labels, apName) {
			continue
		}
		id := strings.TrimSpace(labels[publicAddressIDLabel])
		if id == "" {
			continue
		}
		switch strings.TrimSpace(strings.ToLower(labels[publicAddressKindLabel])) {
		case "platform":
			state.platformIngresses[id] = ingress
		case "custom-domain", "custom":
			state.customIngresses[id] = ingress
		}
	}
	for _, certificate := range certificates {
		labels := labelsOf(certificate)
		if !isPublicAccessSupportForAP(labels, apName) {
			continue
		}
		name := getString(certificate, "metadata", "name")
		if name != "" {
			state.certificates[name] = certificate
		}
	}
	return state
}

func isPublicAccessSupportForAP(labels map[string]string, apName string) bool {
	return labels[brainDeploymentKindLabel] == directAPDeploymentKind &&
		labels[brainDeploymentNameLabel] == apName
}

func labelsOf(resource map[string]interface{}) map[string]string {
	raw, _ := resource["metadata"].(map[string]interface{})
	labels, _ := raw["labels"].(map[string]interface{})
	out := make(map[string]string, len(labels))
	for key, value := range labels {
		if s, ok := value.(string); ok {
			out[key] = s
		}
	}
	return out
}

func projectPlatformAddressSupportHealth(row, ap map[string]interface{}, namespace, serviceName string, address platformAddressRequest, appListeningPortSet map[int]bool, support publicAccessSupportState) {
	host := platformAddressHost(namespace, getString(ap, "metadata", "name"), address.id, address.domainPrefix, apRoutingDomain(ap))
	row["id"] = address.id
	row["port"] = address.port
	row["type"] = "platform"
	if host != "" {
		row["host"] = host
		row["url"] = fmt.Sprintf("https://%s/", host)
	}
	if publicAddressTargetPortMissing(address.port, appListeningPortSet) {
		row["reason"] = "target-port-missing"
		row["status"] = "blocked"
		return
	}
	delete(row, "reason")
	if publicAddressIngressMatches(support.platformIngresses[address.id], host, serviceName, address.port) {
		row["status"] = "accessible"
		return
	}
	row["status"] = "progressing"
}

func projectCustomDomainSupportHealth(
	row map[string]interface{},
	ap map[string]interface{},
	namespace string,
	serviceName string,
	target platformAddressRequest,
	customDomain customDomainRequest,
	appListeningPortSet map[int]bool,
	support publicAccessSupportState,
) {
	row["host"] = customDomain.domain
	row["id"] = customDomain.id
	row["platformAddressId"] = customDomain.platformAddressID
	row["port"] = target.port
	row["type"] = "custom"
	row["url"] = fmt.Sprintf("https://%s/", customDomain.domain)
	cnameTarget := platformAddressHost(namespace, getString(ap, "metadata", "name"), customDomain.platformAddressID, target.domainPrefix, apRoutingDomain(ap))
	if cnameTarget != "" {
		row["cnameTarget"] = cnameTarget
	}
	dnsDetail := customDomainDNSDetail(customDomain, cnameTarget)
	certName := orchestration.APCustomDomainTLSResourceName(getString(ap, "metadata", "name"), customDomain.id)
	certificateDetail := certificateHealthDetail(support.certificates[certName])
	routingDetail := routingHealthDetail(support.customIngresses[customDomain.id], customDomain.domain, serviceName, target.port)
	row["dns"] = dnsDetail
	row["certificate"] = certificateDetail
	row["routing"] = routingDetail
	if publicAddressTargetPortMissing(target.port, appListeningPortSet) {
		row["reason"] = "target-port-missing"
		row["status"] = "blocked"
		return
	}
	if detailFailed(dnsDetail) || detailFailed(certificateDetail) || detailFailed(routingDetail) {
		row["reason"] = firstDetailFailureReason(dnsDetail, certificateDetail, routingDetail)
		row["status"] = "blocked"
		return
	}
	delete(row, "reason")
	if detailReady(dnsDetail) && detailReady(certificateDetail) && detailReady(routingDetail) {
		row["status"] = "accessible"
		return
	}
	row["status"] = "verifying"
}

func customDomainDNSDetail(customDomain customDomainRequest, cnameTarget string) map[string]interface{} {
	status := customDomain.dnsStatus
	if status == "" {
		status = "verifying"
	}
	detail := map[string]interface{}{"status": status}
	if customDomain.dnsTarget != "" {
		detail["target"] = customDomain.dnsTarget
	}
	if customDomain.dnsVerifiedAt != "" {
		detail["verifiedAt"] = customDomain.dnsVerifiedAt
	}
	if cnameTarget != "" && customDomain.dnsTarget != "" && !strings.EqualFold(customDomain.dnsTarget, cnameTarget) {
		detail["status"] = "failed"
		detail["reason"] = "cname-target-mismatch"
		detail["message"] = fmt.Sprintf("CNAME target %s does not match %s.", customDomain.dnsTarget, cnameTarget)
	}
	return detail
}

func certificateHealthDetail(certificate map[string]interface{}) map[string]interface{} {
	if certificate == nil {
		return map[string]interface{}{
			"message": "Custom Domain certificate has not been observed yet.",
			"status":  "verifying",
		}
	}
	conditions, _ := getSlice(certificate, "status", "conditions")
	for _, item := range conditions {
		condition, _ := item.(map[string]interface{})
		if condition == nil || strings.TrimSpace(getString(condition, "type")) != "Ready" {
			continue
		}
		status := strings.TrimSpace(getString(condition, "status"))
		if strings.EqualFold(status, "True") {
			return map[string]interface{}{"status": "ready"}
		}
		if strings.EqualFold(status, "False") {
			detail := map[string]interface{}{"status": "failed"}
			if reason := strings.TrimSpace(getString(condition, "reason")); reason != "" {
				detail["reason"] = reason
			}
			if message := strings.TrimSpace(getString(condition, "message")); message != "" {
				detail["message"] = message
			}
			return detail
		}
	}
	return map[string]interface{}{"status": "verifying"}
}

func routingHealthDetail(ingress map[string]interface{}, host, serviceName string, port int) map[string]interface{} {
	if ingress == nil {
		return map[string]interface{}{
			"message": "Custom Domain Ingress has not been observed yet.",
			"status":  "verifying",
		}
	}
	if publicAddressIngressMatches(ingress, host, serviceName, port) {
		return map[string]interface{}{"status": "ready"}
	}
	return map[string]interface{}{
		"reason":  "routing-mismatch",
		"message": "Custom Domain Ingress does not match the binding target.",
		"status":  "failed",
	}
}

func publicAddressIngressMatches(ingress map[string]interface{}, host, serviceName string, port int) bool {
	if ingress == nil || host == "" || serviceName == "" || port <= 0 {
		return false
	}
	rules, _ := getSlice(ingress, "spec", "rules")
	for _, item := range rules {
		rule, _ := item.(map[string]interface{})
		if rule == nil || !strings.EqualFold(strings.TrimSpace(getString(rule, "host")), host) {
			continue
		}
		paths, _ := getSlice(rule, "http", "paths")
		for _, pathItem := range paths {
			path, _ := pathItem.(map[string]interface{})
			backend, _ := path["backend"].(map[string]interface{})
			service, _ := backend["service"].(map[string]interface{})
			if strings.TrimSpace(getString(service, "name")) != serviceName {
				continue
			}
			if publicAddressBackendPort(service) == port {
				return true
			}
		}
	}
	return false
}

func publicAddressBackendPort(service map[string]interface{}) int {
	portMap, _ := service["port"].(map[string]interface{})
	port, ok := privatePortFromValue(portMap["number"])
	if ok {
		return port
	}
	return 0
}

func detailReady(detail map[string]interface{}) bool {
	status := strings.TrimSpace(strings.ToLower(getString(detail, "status")))
	return status == "ready" || status == "verified"
}

func detailFailed(detail map[string]interface{}) bool {
	status := strings.TrimSpace(strings.ToLower(getString(detail, "status")))
	return status == "failed" || status == "blocked"
}

func firstDetailFailureReason(details ...map[string]interface{}) string {
	for _, detail := range details {
		if !detailFailed(detail) {
			continue
		}
		if reason := strings.TrimSpace(getString(detail, "reason")); reason != "" {
			return reason
		}
	}
	return "public-access-health-failed"
}

func platformAddressIDSet(addresses []platformAddressRequest) map[string]bool {
	ids := make(map[string]bool, len(addresses))
	for _, address := range addresses {
		ids[address.id] = true
	}
	return ids
}

func apRoutingDomain(ap map[string]interface{}) string {
	return strings.TrimSpace(getString(ap, "metadata", "labels", "region"))
}

func platformAddressHost(namespace string, name string, id string, domainPrefix string, domain string) string {
	namespace = strings.TrimSpace(namespace)
	name = strings.TrimSpace(name)
	id = strings.TrimSpace(id)
	domain = strings.TrimSpace(domain)
	if namespace == "" || name == "" || !platformAddressIDPattern.MatchString(id) || domain == "" {
		return ""
	}
	label := strings.TrimSpace(strings.ToLower(domainPrefix))
	if !platformAddressDomainPrefixPattern.MatchString(label) {
		label = stablePlatformAddressHostLabel(fmt.Sprintf("%s/%s/%s", namespace, name, id), 6)
	}
	return fmt.Sprintf("%s.%s", label, domain)
}

func stablePlatformAddressHostLabel(source string, length int) string {
	if length <= 0 {
		return ""
	}
	sum := sha256.Sum256([]byte(strings.TrimSpace(source)))
	out := make([]byte, 0, length)
	for i := 0; len(out) < length; i++ {
		out = append(out, platformAddressHostAlphabet[sum[i%len(sum)]%byte(len(platformAddressHostAlphabet))])
	}
	return string(out)
}

func privatePortFromValue(value interface{}) (int, bool) {
	var port int
	switch v := value.(type) {
	case float64:
		if v != math.Trunc(v) || v < 1 || v > 65535 {
			return 0, false
		}
		port = int(v)
	case int:
		port = v
	case int64:
		port = int(v)
	case int32:
		port = int(v)
	case string:
		p, err := strconv.Atoi(v)
		if err != nil {
			return 0, false
		}
		port = p
	default:
		return 0, false
	}
	if port < 1 || port > 65535 {
		return 0, false
	}
	return port, true
}

// buildConnectionRows composes internal and external addresses for the older status.variables table.
// These rows are derived from observed resources, not from the AP Network contract.
func buildConnectionRows(ap map[string]interface{}, ingresses, services []map[string]interface{}) []map[string]interface{} {
	apNamespace := getString(ap, "metadata", "namespace")
	if apNamespace == "" && len(services) > 0 {
		apNamespace = getString(services[0], "metadata", "namespace")
	}
	if apNamespace == "" && len(ingresses) > 0 {
		apNamespace = getString(ingresses[0], "metadata", "namespace")
	}
	if apNamespace == "" {
		return nil
	}
	externalBySvcPort := buildExternalAddressMap(ingresses, apNamespace)

	var rows []map[string]interface{}
	seen := make(map[string]bool)
	for _, svc := range services {
		svcName := getString(svc, "metadata", "name")
		svcNamespace := getString(svc, "metadata", "namespace")
		if svcNamespace == "" {
			svcNamespace = apNamespace
		}
		ports := getPorts(svc)
		for _, port := range ports {
			internalName := "port-" + strconv.Itoa(port) + "-internal"
			if !seen[internalName] {
				seen[internalName] = true
				internalAddr := fmt.Sprintf("http://%s.%s.svc.cluster.local:%d", svcName, svcNamespace, port)
				rows = append(rows, map[string]interface{}{
					"name":    internalName,
					"address": internalAddr,
					"type":    "internal",
					"port":    port,
				})
			}

			extKey := svcName + ":" + strconv.Itoa(port)
			if extAddr, ok := externalBySvcPort[extKey]; ok {
				externalName := "port-" + strconv.Itoa(port) + "-external"
				if !seen[externalName] {
					seen[externalName] = true
					rows = append(rows, map[string]interface{}{
						"name":    externalName,
						"address": extAddr,
						"type":    "external",
						"port":    port,
					})
				}
			}
		}
	}
	return rows
}

// buildVariablesFromConnectionRows converts observed connection rows to the variable table.
// Each row becomes { name, value } with the address as the value.
func buildVariablesFromConnectionRows(rows []map[string]interface{}) []map[string]interface{} {
	if len(rows) == 0 {
		return nil
	}
	vars := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		name, _ := row["name"].(string)
		addr, _ := row["address"].(string)
		if name != "" && addr != "" {
			vars = append(vars, map[string]interface{}{
				"name":  name,
				"value": addr,
			})
		}
	}
	return vars
}

func getString(obj map[string]interface{}, keys ...string) string {
	for i, k := range keys {
		if obj == nil {
			return ""
		}
		v, _ := obj[k]
		if i == len(keys)-1 {
			if s, ok := v.(string); ok {
				return s
			}
			return ""
		}
		obj, _ = v.(map[string]interface{})
	}
	return ""
}

func getSlice(obj map[string]interface{}, keys ...string) ([]interface{}, bool) {
	for i, k := range keys {
		if obj == nil {
			return nil, false
		}
		v, _ := obj[k]
		if i == len(keys)-1 {
			out, ok := v.([]interface{})
			return out, ok
		}
		obj, _ = v.(map[string]interface{})
	}
	return nil, false
}

func getMap(obj map[string]interface{}, keys ...string) (map[string]interface{}, bool) {
	for i, k := range keys {
		if obj == nil {
			return nil, false
		}
		v, _ := obj[k]
		next, ok := v.(map[string]interface{})
		if i == len(keys)-1 {
			return next, ok
		}
		if !ok {
			return nil, false
		}
		obj = next
	}
	return nil, false
}

func getPorts(svc map[string]interface{}) []int {
	spec, _ := svc["spec"].(map[string]interface{})
	if spec == nil {
		return nil
	}
	rawPorts, _ := spec["ports"].([]interface{})
	if rawPorts == nil {
		return nil
	}
	var ports []int
	for _, p := range rawPorts {
		portMap, _ := p.(map[string]interface{})
		if portMap == nil {
			continue
		}
		switch v := portMap["port"].(type) {
		case float64:
			ports = append(ports, int(v))
		case int:
			ports = append(ports, v)
		case int64:
			ports = append(ports, int(v))
		case int32:
			ports = append(ports, int(v))
		case string:
			if p, err := strconv.Atoi(v); err == nil {
				ports = append(ports, p)
			}
		}
	}
	return ports
}

func buildExternalAddressMap(ingresses []map[string]interface{}, namespace string) map[string]string {
	result := make(map[string]string)
	for _, ing := range ingresses {
		ingNamespace := getString(ing, "metadata", "namespace")
		if ingNamespace == "" {
			ingNamespace = namespace
		}
		lbHost := getLoadBalancerHost(ing)
		spec, _ := ing["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		tlsHosts := getTLSHosts(spec)
		rules, _ := spec["rules"].([]interface{})
		if rules == nil {
			continue
		}
		for _, r := range rules {
			rule, _ := r.(map[string]interface{})
			if rule == nil {
				continue
			}
			host, _ := rule["host"].(string)
			if host == "" {
				host = lbHost
			}
			if host == "" || isPlaceholderIngressHost(host) {
				continue
			}
			httpRule, _ := rule["http"].(map[string]interface{})
			if httpRule == nil {
				continue
			}
			paths, _ := httpRule["paths"].([]interface{})
			if paths == nil {
				continue
			}
			scheme := "http"
			if tlsHosts[host] {
				scheme = "https"
			}
			for _, p := range paths {
				pathObj, _ := p.(map[string]interface{})
				if pathObj == nil {
					continue
				}
				path, _ := pathObj["path"].(string)
				if path == "" {
					path = "/"
				}
				if path[0] != '/' {
					path = "/" + path
				}
				backend, _ := pathObj["backend"].(map[string]interface{})
				if backend == nil {
					continue
				}
				svcRef, _ := backend["service"].(map[string]interface{})
				if svcRef == nil {
					continue
				}
				svcName, _ := svcRef["name"].(string)
				if svcName == "" {
					continue
				}
				var port int
				if portObj, ok := svcRef["port"].(map[string]interface{}); ok {
					switch v := portObj["number"].(type) {
					case float64:
						port = int(v)
					case int:
						port = v
					case int64:
						port = int(v)
					case int32:
						port = int(v)
					case string:
						if p, err := strconv.Atoi(v); err == nil {
							port = p
						}
					}
				}
				if port == 0 {
					continue
				}
				addr := fmt.Sprintf("%s://%s%s", scheme, host, path)
				key := svcName + ":" + strconv.Itoa(port)
				if _, exists := result[key]; !exists {
					result[key] = addr
				}
			}
		}
	}
	return result
}

func getLoadBalancerHost(ing map[string]interface{}) string {
	status, _ := ing["status"].(map[string]interface{})
	if status == nil {
		return ""
	}
	lb, _ := status["loadBalancer"].(map[string]interface{})
	if lb == nil {
		return ""
	}
	ingresses, _ := lb["ingress"].([]interface{})
	if len(ingresses) == 0 {
		return ""
	}
	first, _ := ingresses[0].(map[string]interface{})
	if first == nil {
		return ""
	}
	if h, ok := first["hostname"].(string); ok && h != "" {
		return h
	}
	if ip, ok := first["ip"].(string); ok && ip != "" {
		return ip
	}
	return ""
}

func getTLSHosts(spec map[string]interface{}) map[string]bool {
	hosts := make(map[string]bool)
	tls, _ := spec["tls"].([]interface{})
	if tls == nil {
		return hosts
	}
	for _, t := range tls {
		tlsMap, _ := t.(map[string]interface{})
		if tlsMap == nil {
			continue
		}
		rawHosts, _ := tlsMap["hosts"].([]interface{})
		for _, h := range rawHosts {
			if s, ok := h.(string); ok {
				hosts[s] = true
			}
		}
	}
	return hosts
}
