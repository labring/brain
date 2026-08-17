package ap

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"sealos/api/service/orchestration"
)

// defaultIngressHostPlaceholder is a placeholder from older generated templates.
// It must not surface as a real connection URL.
const defaultIngressHostPlaceholder = "placeholder.example.com"

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

func mergePublicNetworkStatus(ap map[string]interface{}, status map[string]interface{}) {
	intent := apNetworkIntent(ap)
	platformAddresses := intent.PlatformAddresses
	if len(platformAddresses) == 0 {
		removePublicNetworkStatus(status)
		return
	}
	customDomains := intent.CustomDomains
	networkCopy := networkStatusCopy(status)
	if _, exists := networkCopy["publicAddresses"]; exists {
		publicAddresses := publicAddressRowsForIntent(
			publicAddressRowsFromValue(networkCopy["publicAddresses"]),
			intent,
		)
		seenIDs, promotedPlatformAddressIDs := publicAddressMergeState(publicAddresses)
		for _, customDomain := range customDomains {
			if seenIDs[customDomain.ID] {
				promotedPlatformAddressIDs[customDomain.PlatformAddressID] = true
				continue
			}
			row := pendingCustomDomainRow(ap, intent, customDomain)
			if row == nil {
				continue
			}
			publicAddresses = append(publicAddresses, row)
			seenIDs[customDomain.ID] = true
			promotedPlatformAddressIDs[customDomain.PlatformAddressID] = true
		}
		publicAddresses = hidePromotedPlatformAddressRows(publicAddresses, promotedPlatformAddressIDs)
		for _, address := range platformAddresses {
			if seenIDs[address.ID] || promotedPlatformAddressIDs[address.ID] {
				continue
			}
			publicAddresses = append(publicAddresses, pendingPublicAddressRow(ap, intent, address))
		}
		networkCopy["publicAddresses"] = canonicalPublicAddressRows(publicAddresses)
		status["network"] = networkCopy
		return
	}

	promotedPlatformAddressIDs := make(map[string]bool)
	publicAddresses := make([]map[string]interface{}, 0, len(platformAddresses)+len(customDomains))
	for _, customDomain := range customDomains {
		row := pendingCustomDomainRow(ap, intent, customDomain)
		if row == nil {
			continue
		}
		publicAddresses = append(publicAddresses, row)
		promotedPlatformAddressIDs[customDomain.PlatformAddressID] = true
	}
	for _, address := range platformAddresses {
		if promotedPlatformAddressIDs[address.ID] {
			continue
		}
		publicAddresses = append(publicAddresses, pendingPublicAddressRow(ap, intent, address))
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
	servicePorts := make(map[string]observedServicePorts, len(services))
	for _, service := range services {
		name := strings.TrimSpace(getString(service, "metadata", "name"))
		if name == "" {
			continue
		}
		serviceNames[name] = true
		servicePorts[name] = observedServicePortsFromService(service)
	}
	rows := observedPublicAddressRows(ingresses, serviceNames, servicePorts)
	if len(rows) == 0 {
		return
	}
	networkCopy["publicAddresses"] = rows
	status["network"] = networkCopy
}

type observedServicePorts struct {
	numbers map[int]bool
	names   map[string]int
}

type observedIngressEndpoint struct {
	host       string
	key        string
	path       string
	port       int
	scheme     string
	serviceKey string
}

func observedServicePortsFromService(service map[string]interface{}) observedServicePorts {
	out := observedServicePorts{
		numbers: make(map[int]bool),
		names:   make(map[string]int),
	}
	spec, _ := service["spec"].(map[string]interface{})
	rawPorts, _ := spec["ports"].([]interface{})
	for _, item := range rawPorts {
		portMap, _ := item.(map[string]interface{})
		if portMap == nil {
			continue
		}
		port, ok := privatePortFromValue(portMap["port"])
		if !ok {
			continue
		}
		out.numbers[port] = true
		if name := strings.TrimSpace(getString(portMap, "name")); name != "" {
			out.names[name] = port
		}
	}
	return out
}

func (ports observedServicePorts) resolveBackendPort(service map[string]interface{}) int {
	if port := publicAddressBackendPort(service); port > 0 {
		return port
	}
	portMap, _ := service["port"].(map[string]interface{})
	name := strings.TrimSpace(getString(portMap, "name"))
	if name == "" {
		return 0
	}
	return ports.names[name]
}

func (ports observedServicePorts) hasPort(port int) bool {
	if len(ports.numbers) == 0 {
		return true
	}
	return ports.numbers[port]
}

func observedIngressEndpoints(ingresses []map[string]interface{}, serviceNames map[string]bool, servicePorts map[string]observedServicePorts) []observedIngressEndpoint {
	endpoints := []observedIngressEndpoint{}
	includeAllServices := len(serviceNames) == 0
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
			pickedFirst := false
			for _, pathItem := range paths {
				if pickedFirst {
					break
				}
				path, _ := pathItem.(map[string]interface{})
				if path == nil {
					continue
				}
				service, _ := getMap(path, "backend", "service")
				serviceName := strings.TrimSpace(getString(service, "name"))
				if !includeAllServices && !serviceNames[serviceName] {
					continue
				}
				ports := servicePorts[serviceName]
				port := ports.resolveBackendPort(service)
				if port <= 0 || !ports.hasPort(port) {
					continue
				}
				pickedFirst = true
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
				endpoints = append(endpoints, observedIngressEndpoint{
					host:       host,
					key:        fmt.Sprintf("%s|%s|%d", host, serviceName, port),
					path:       pathValue,
					port:       port,
					scheme:     scheme,
					serviceKey: serviceName + ":" + strconv.Itoa(port),
				})
			}
		}
	}
	return endpoints
}

func observedPublicAddressRows(ingresses []map[string]interface{}, serviceNames map[string]bool, servicePorts map[string]observedServicePorts) []map[string]interface{} {
	rows := []map[string]interface{}{}
	seen := map[string]bool{}
	for _, endpoint := range observedIngressEndpoints(ingresses, serviceNames, servicePorts) {
		if seen[endpoint.key] {
			continue
		}
		seen[endpoint.key] = true
		rows = append(rows, map[string]interface{}{
			"host":   endpoint.host,
			"id":     "observed-" + stablePlatformAddressHostLabel(endpoint.key, 12),
			"port":   endpoint.port,
			"status": "accessible",
			"type":   "observed",
			"url":    fmt.Sprintf("%s://%s%s", endpoint.scheme, endpoint.host, endpoint.path),
		})
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

func publicAddressRowsForIntent(rows []map[string]interface{}, intent orchestration.APNetworkIntent) []map[string]interface{} {
	if len(rows) == 0 {
		return rows
	}
	intentIDs := orchestration.APPublicAddressIntentIDs(intent)
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

func apNetworkIntent(ap map[string]interface{}) orchestration.APNetworkIntent {
	network := apInputNetwork(ap)
	if network == nil {
		return orchestration.APNetworkIntent{}
	}
	intent := orchestration.APNetworkIntent{
		PlatformAddresses: orchestration.APPlatformAddressRequestsFromNetwork(network),
	}
	intent.CustomDomains = orchestration.APCustomDomainRequestsFromNetwork(network, intent.PlatformAddresses)
	for _, port := range apAppListeningPorts(ap) {
		if orchestration.IsValidAPPort(int32(port)) {
			intent.AppListeningPorts = append(intent.AppListeningPorts, orchestration.APAppListeningPort{Port: int32(port)})
		}
	}
	return intent
}

func apPublicAddressProjectionInput(ap map[string]interface{}, intent orchestration.APNetworkIntent) orchestration.APPublicAddressProjectionInput {
	return orchestration.APPublicAddressProjectionInput{
		APName:        getString(ap, "metadata", "name"),
		Intent:        intent,
		Namespace:     getString(ap, "metadata", "namespace"),
		RoutingDomain: apRoutingDomain(ap),
	}
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
		if orchestration.IsValidAPPlatformAddressID(platformAddressID) {
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

func pendingPublicAddressRow(ap map[string]interface{}, intent orchestration.APNetworkIntent, address orchestration.APPlatformAddressRequest) map[string]interface{} {
	return orchestration.APPublicAddressRowForPlatform(apPublicAddressProjectionInput(ap, intent), address)
}

func pendingCustomDomainRow(
	ap map[string]interface{},
	intent orchestration.APNetworkIntent,
	customDomain orchestration.APCustomDomainRequest,
) map[string]interface{} {
	row, ok := orchestration.APPublicAddressRowForCustomDomain(apPublicAddressProjectionInput(ap, intent), customDomain)
	if !ok {
		return nil
	}
	return row
}

type publicAccessSupportState struct {
	ingresses    []map[string]interface{}
	certificates map[string]map[string]interface{}
}

const (
	brainDeploymentKindLabel = "brain.io/deployment-kind"
	brainDeploymentNameLabel = "brain.io/deployment-name"
	directAPDeploymentKind   = "ap"
	launchpadManagerLabel    = "cloud.sealos.io/app-deploy-manager"
)

func mergePublicAccessSupportHealth(ap map[string]interface{}, status map[string]interface{}, ingresses, certificates, issuers []map[string]interface{}) {
	intent := apNetworkIntent(ap)
	platformAddresses := intent.PlatformAddresses
	if len(platformAddresses) == 0 {
		return
	}
	customDomains := intent.CustomDomains
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
		target, ok := orchestration.APPlatformAddressRequestByID(platformAddresses, customDomain.PlatformAddressID)
		if !ok {
			continue
		}
		row := rowsByID[customDomain.ID]
		if row == nil {
			row = pendingCustomDomainRow(ap, intent, customDomain)
			if row == nil {
				continue
			}
			publicAddresses = append(publicAddresses, row)
			rowsByID[customDomain.ID] = row
		}
		projectCustomDomainSupportHealth(row, ap, namespace, serviceName, target, customDomain, intent, support)
		promotedPlatformAddressIDs[customDomain.PlatformAddressID] = true
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
		if promotedPlatformAddressIDs[address.ID] {
			continue
		}
		row := rowsByID[address.ID]
		if row == nil {
			row = pendingPublicAddressRow(ap, intent, address)
			publicAddresses = append(publicAddresses, row)
			rowsByID[address.ID] = row
		}
		projectPlatformAddressSupportHealth(row, ap, namespace, serviceName, address, intent, support)
	}

	networkCopy["publicAddresses"] = canonicalPublicAddressRows(publicAddresses)
	status["network"] = networkCopy
}

func publicAccessSupportStateFromResources(apName string, ingresses, certificates []map[string]interface{}) publicAccessSupportState {
	state := publicAccessSupportState{
		certificates: make(map[string]map[string]interface{}),
	}
	for _, ingress := range ingresses {
		labels := labelsOf(ingress)
		if !isPublicAccessSupportForAP(labels, apName) {
			continue
		}
		state.ingresses = append(state.ingresses, ingress)
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
	if labels[brainDeploymentKindLabel] == directAPDeploymentKind &&
		labels[brainDeploymentNameLabel] == apName {
		return true
	}
	return labels[launchpadManagerLabel] == apName
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

func projectPlatformAddressSupportHealth(row, ap map[string]interface{}, namespace, serviceName string, address orchestration.APPlatformAddressRequest, intent orchestration.APNetworkIntent, support publicAccessSupportState) {
	host := orchestration.PlatformAddressHost(namespace, getString(ap, "metadata", "name"), address.ID, address.DomainPrefix, apRoutingDomain(ap))
	row["id"] = address.ID
	row["port"] = int(address.Port)
	row["type"] = "platform"
	if host != "" {
		row["host"] = host
		row["url"] = fmt.Sprintf("https://%s/", host)
	}
	if orchestration.APPublicAddressTargetPortMissing(address.Port, intent.AppListeningPorts) {
		row["reason"] = "target-port-missing"
		row["status"] = "blocked"
		return
	}
	delete(row, "reason")
	if publicAccessIngressObserved(support.ingresses, host, serviceName, int(address.Port)) {
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
	target orchestration.APPlatformAddressRequest,
	customDomain orchestration.APCustomDomainRequest,
	intent orchestration.APNetworkIntent,
	support publicAccessSupportState,
) {
	row["host"] = customDomain.Domain
	row["id"] = customDomain.ID
	row["platformAddressId"] = customDomain.PlatformAddressID
	row["port"] = int(target.Port)
	row["type"] = "custom"
	row["url"] = fmt.Sprintf("https://%s/", customDomain.Domain)
	cnameTarget := orchestration.PlatformAddressHost(namespace, getString(ap, "metadata", "name"), customDomain.PlatformAddressID, target.DomainPrefix, apRoutingDomain(ap))
	if cnameTarget != "" {
		row["cnameTarget"] = cnameTarget
	}
	dnsDetail := customDomainDNSDetail(customDomain, cnameTarget)
	certName := orchestration.APCustomDomainTLSResourceName(getString(ap, "metadata", "name"), customDomain.ID)
	certificateDetail := certificateHealthDetail(support.certificates[certName])
	routingDetail := routingHealthDetail(support.ingresses, customDomain.Domain, serviceName, int(target.Port))
	row["dns"] = dnsDetail
	row["certificate"] = certificateDetail
	row["routing"] = routingDetail
	if orchestration.APPublicAddressTargetPortMissing(target.Port, intent.AppListeningPorts) {
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

func customDomainDNSDetail(customDomain orchestration.APCustomDomainRequest, cnameTarget string) map[string]interface{} {
	status := customDomain.DNSStatus
	if status == "" {
		status = "verifying"
	}
	detail := map[string]interface{}{"status": status}
	if customDomain.DNSTarget != "" {
		detail["target"] = customDomain.DNSTarget
	}
	if customDomain.DNSVerifiedAt != "" {
		detail["verifiedAt"] = customDomain.DNSVerifiedAt
	}
	if cnameTarget != "" && customDomain.DNSTarget != "" && !strings.EqualFold(customDomain.DNSTarget, cnameTarget) {
		detail["status"] = "failed"
		detail["reason"] = "cname-target-mismatch"
		detail["message"] = fmt.Sprintf("CNAME target %s does not match %s.", customDomain.DNSTarget, cnameTarget)
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

func routingHealthDetail(ingresses []map[string]interface{}, host, serviceName string, port int) map[string]interface{} {
	if len(ingresses) == 0 {
		return map[string]interface{}{
			"message": "Custom Domain Ingress has not been observed yet.",
			"status":  "verifying",
		}
	}
	if publicAccessIngressObserved(ingresses, host, serviceName, port) {
		return map[string]interface{}{"status": "ready"}
	}
	if !publicAccessIngressHostObserved(ingresses, host) {
		return map[string]interface{}{
			"message": "Custom Domain Ingress has not been observed yet.",
			"status":  "verifying",
		}
	}
	return map[string]interface{}{
		"reason":  "routing-mismatch",
		"message": "Custom Domain Ingress does not match the binding target.",
		"status":  "failed",
	}
}

func publicAccessIngressObserved(ingresses []map[string]interface{}, host, serviceName string, port int) bool {
	for _, ingress := range ingresses {
		if publicAddressIngressMatches(ingress, host, serviceName, port) {
			return true
		}
	}
	return false
}

func publicAccessIngressHostObserved(ingresses []map[string]interface{}, host string) bool {
	host = strings.TrimSpace(host)
	if host == "" {
		return false
	}
	for _, ingress := range ingresses {
		rules, _ := getSlice(ingress, "spec", "rules")
		for _, item := range rules {
			rule, _ := item.(map[string]interface{})
			if rule != nil && strings.EqualFold(strings.TrimSpace(getString(rule, "host")), host) {
				return true
			}
		}
	}
	return false
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

func apRoutingDomain(ap map[string]interface{}) string {
	return strings.TrimSpace(getString(ap, "metadata", "labels", orchestration.APRoutingDomainLabel))
}

func stablePlatformAddressHostLabel(source string, length int) string {
	return orchestration.APStableLowercaseLetters(source, length)
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
	externalBySvcPort := buildExternalAddressMap(ingresses)

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

func buildExternalAddressMap(ingresses []map[string]interface{}) map[string]string {
	result := make(map[string]string)
	for _, endpoint := range observedIngressEndpoints(ingresses, map[string]bool{}, map[string]observedServicePorts{}) {
		addr := fmt.Sprintf("%s://%s%s", endpoint.scheme, endpoint.host, endpoint.path)
		if _, exists := result[endpoint.serviceKey]; !exists {
			result[endpoint.serviceKey] = addr
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
