package ap

import (
	"crypto/sha256"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// APCompositeLabel is the label key used to find direct support resources for an AP instance.
const APCompositeLabel = "brain.io/app-name"

// defaultIngressHostFromComposition is a placeholder from older generated templates.
// It must not surface as a real connection URL.
const defaultIngressHostFromComposition = "placeholder.example.com"
const platformAddressHostPrefixMaxLength = 52

var platformAddressHostUnsafeCharsPattern = regexp.MustCompile(`[^a-z0-9-]+`)
var platformAddressIDPattern = regexp.MustCompile(`^pa_[a-z0-9]{6,32}$`)
var customDomainBindingIDPattern = regexp.MustCompile(`^cd_[a-z0-9]{6,32}$`)

func isPlaceholderIngressHost(host string) bool {
	h := strings.TrimSpace(strings.ToLower(host))
	if h == defaultIngressHostFromComposition {
		return true
	}
	suffix := "." + defaultIngressHostFromComposition
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
	out["status"] = statusCopy

	return out
}

func mergePrivateNetworkStatus(ap map[string]interface{}, status map[string]interface{}, services []map[string]interface{}) {
	privatePort, ok := apPrivatePort(ap)
	if !ok {
		return
	}

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
	network := apInputNetwork(ap)
	if network == nil {
		return 0, false
	}
	return privatePortFromValue(network["privatePort"])
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
	id   string
	port int
}

type customDomainRequest struct {
	domain            string
	id                string
	platformAddressID string
}

func mergePublicNetworkStatus(ap map[string]interface{}, status map[string]interface{}) {
	platformAddresses := apPlatformAddressRequests(ap)
	if len(platformAddresses) == 0 {
		return
	}
	customDomains := apCustomDomainRequests(ap, platformAddresses)
	networkCopy := networkStatusCopy(status)
	if _, exists := networkCopy["publicAddresses"]; exists {
		publicAddresses := publicAddressRowsFromValue(networkCopy["publicAddresses"])
		seenIDs, promotedPlatformAddressIDs := publicAddressMergeState(publicAddresses)
		for _, customDomain := range customDomains {
			if seenIDs[customDomain.id] {
				promotedPlatformAddressIDs[customDomain.platformAddressID] = true
				continue
			}
			row := pendingCustomDomainRow(ap, platformAddresses, customDomain)
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
			publicAddresses = append(publicAddresses, pendingPublicAddressRow(ap, address))
		}
		networkCopy["publicAddresses"] = publicAddresses
		status["network"] = networkCopy
		return
	}

	promotedPlatformAddressIDs := make(map[string]bool)
	publicAddresses := make([]map[string]interface{}, 0, len(platformAddresses)+len(customDomains))
	for _, customDomain := range customDomains {
		row := pendingCustomDomainRow(ap, platformAddresses, customDomain)
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
		publicAddresses = append(publicAddresses, pendingPublicAddressRow(ap, address))
	}
	networkCopy["publicAddresses"] = publicAddresses
	status["network"] = networkCopy
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

func pendingPublicAddressRow(ap map[string]interface{}, address platformAddressRequest) map[string]interface{} {
	row := map[string]interface{}{
		"id":     address.id,
		"port":   address.port,
		"status": "progressing",
		"type":   "platform",
	}
	host := platformAddressHost(
		getString(ap, "metadata", "namespace"),
		getString(ap, "metadata", "name"),
		address.id,
		apRoutingDomain(ap),
	)
	if host == "" {
		return row
	}
	row["host"] = host
	row["url"] = fmt.Sprintf("https://%s/", host)
	return row
}

func pendingCustomDomainRow(
	ap map[string]interface{},
	platformAddresses []platformAddressRequest,
	customDomain customDomainRequest,
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
		"status":            "pending",
		"type":              "custom",
		"url":               fmt.Sprintf("https://%s/", customDomain.domain),
	}
	cnameTarget := platformAddressHost(
		getString(ap, "metadata", "namespace"),
		getString(ap, "metadata", "name"),
		customDomain.platformAddressID,
		apRoutingDomain(ap),
	)
	if cnameTarget != "" {
		row["cnameTarget"] = cnameTarget
	}
	return row
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
		addresses = append(addresses, platformAddressRequest{id: id, port: port})
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
		customDomains = append(customDomains, customDomainRequest{
			domain:            domain,
			id:                id,
			platformAddressID: platformAddressID,
		})
	}
	return customDomains
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

func platformAddressHost(namespace string, name string, id string, domain string) string {
	namespace = strings.TrimSpace(namespace)
	name = strings.TrimSpace(name)
	id = strings.TrimSpace(id)
	domain = strings.TrimSpace(domain)
	if namespace == "" || name == "" || !platformAddressIDPattern.MatchString(id) || domain == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s/%s/%s", namespace, name, id)))
	return fmt.Sprintf("%s-%x.%s", platformAddressHostPrefix(name), sum[:5], domain)
}

func platformAddressHostPrefix(name string) string {
	prefix := strings.ToLower(strings.TrimSpace(name))
	prefix = platformAddressHostUnsafeCharsPattern.ReplaceAllString(prefix, "-")
	prefix = strings.Trim(prefix, "-")
	if len(prefix) > platformAddressHostPrefixMaxLength {
		prefix = prefix[:platformAddressHostPrefixMaxLength]
		prefix = strings.TrimRight(prefix, "-")
	}
	if prefix == "" {
		return "ap"
	}
	return prefix
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
