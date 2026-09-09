package ap

import (
	"fmt"
	"net/url"
	"strings"
)

// Project protocol evidence into the read model, including rows the adapter
// already populated from desired state. This never changes routing intent or health.
func projectObservedNetworkProtocols(status map[string]interface{}, ingresses, services []map[string]interface{}) {
	names, ports := observedServiceLookup(services)
	if len(names) == 0 {
		return
	}
	endpoints := observedIngressEndpoints(ingresses, names, ports)
	network := networkStatusCopy(status)
	addresses := publicAddressRowsFromValue(network["publicAddresses"])
	for _, address := range addresses {
		port, _ := privatePortFromValue(address["port"])
		scheme := ""
		for _, endpoint := range endpoints {
			if endpoint.host != address["host"] || endpoint.port != port {
				continue
			}
			if scheme != "" && scheme != endpoint.scheme {
				scheme = ""
				break
			}
			scheme = endpoint.scheme
		}
		if scheme != "" {
			current, _ := address["url"].(string)
			parsed, err := url.Parse(current)
			if err == nil && parsed.Hostname() == address["host"] {
				parsed.Scheme = scheme
				address["url"] = parsed.String()
			} else {
				address["url"] = fmt.Sprintf("%s://%s/", scheme, address["host"])
			}
		}
	}
	if len(addresses) > 0 {
		network["publicAddresses"] = addresses
	}
	rows, _ := network["appListeningPorts"].([]interface{})
	projected := make([]interface{}, 0, len(rows))
	for _, value := range rows {
		row, ok := value.(map[string]interface{})
		if !ok {
			projected = append(projected, value)
			continue
		}
		row = copyPublicAddressRow(row)
		port, _ := privatePortFromValue(row["port"])
		address, _ := row["privateAddress"].(string)
		matchedProtocol := false
		// The Service identity remains authoritative; never substitute an AP name.
		for _, service := range services {
			name := getString(service, "metadata", "name")
			namespace := getString(service, "metadata", "namespace")
			host := name + "." + namespace + ".svc.cluster.local"
			if !strings.HasPrefix(address, "http://"+host+":") &&
				address != "http://"+host && !strings.HasPrefix(address, "ws://"+host+":") {
				continue
			}
			scheme := privateProtocolForEndpoints(endpoints, fmt.Sprintf("%s:%d", name, port))
			if scheme != "" {
				matchedProtocol = true
				row["privateAddress"] = fmt.Sprintf("%s://%s:%d", scheme, host, port)
				if scheme == "http" && port == 80 {
					row["privateAddress"] = "http://" + host
				}
			}
		}
		projected = append(projected, row)
		if primary, _ := privatePortFromValue(network["privatePort"]); primary == port && matchedProtocol {
			network["privateAddress"] = row["privateAddress"]
		}
	}
	if len(projected) > 0 {
		network["appListeningPorts"] = projected
	}
	if len(network) > 0 {
		status["network"] = network
	}
}

func privateProtocolForEndpoints(endpoints []observedIngressEndpoint, serviceKey string) string {
	scheme := ""
	for _, endpoint := range endpoints {
		if endpoint.serviceKey != serviceKey {
			continue
		}
		candidate := "http"
		if endpoint.scheme == "ws" || endpoint.scheme == "wss" {
			candidate = "ws"
		}
		if scheme != "" && scheme != candidate {
			return ""
		}
		scheme = candidate
	}
	return scheme
}
