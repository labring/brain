package ap

import (
	"fmt"
	"net/url"
	"strings"
)

// Project protocol evidence into the read model, including rows the adapter
// already populated from desired state. This never changes routing intent or
// health, and never hides an HTTP(S) Public Address behind a WebSocket URL.
func projectObservedNetworkProtocols(status map[string]interface{}, ingresses, services []map[string]interface{}) {
	names, ports := observedServiceLookup(services)
	if len(names) == 0 {
		return
	}
	endpoints := observedIngressEndpoints(ingresses, names, ports)
	network := networkStatusCopy(status)
	addresses := publicAddressRowsFromValue(network["publicAddresses"])
	for _, row := range observedPublicAddressRows(ingresses, names, ports) {
		matched := false
		for _, current := range addresses {
			if publicAddressesShareHostPortScheme(current, row) {
				matched = true
				break
			}
		}
		if !matched {
			addresses = append(addresses, row)
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
	http := false
	websocket := false
	for _, endpoint := range endpoints {
		if endpoint.serviceKey != serviceKey {
			continue
		}
		if endpoint.scheme == "ws" || endpoint.scheme == "wss" {
			websocket = true
			continue
		}
		http = true
	}
	// A WS-marked port still uses a ws private scheme (Launchpad). Public
	// HTTP(S) siblings of that port are separate Public Addresses.
	if websocket {
		return "ws"
	}
	if http {
		return "http"
	}
	return ""
}

func publicAddressURLScheme(row map[string]interface{}) string {
	raw, _ := row["url"].(string)
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" {
		return ""
	}
	return strings.ToLower(parsed.Scheme)
}

// publicAddressProtocolRole is web (http/https) vs websocket (ws/wss). TLS
// does not make a second Public Address; a WS marker does.
func publicAddressProtocolRole(row map[string]interface{}) string {
	switch publicAddressURLScheme(row) {
	case "ws", "wss":
		return "websocket"
	case "http", "https":
		return "web"
	default:
		return ""
	}
}

func publicAddressesShareHostPortScheme(left, right map[string]interface{}) bool {
	leftPort, _ := privatePortFromValue(left["port"])
	rightPort, _ := privatePortFromValue(right["port"])
	if left["host"] != right["host"] || leftPort != rightPort || leftPort == 0 {
		return false
	}
	leftRole := publicAddressProtocolRole(left)
	rightRole := publicAddressProtocolRole(right)
	if leftRole == "" || rightRole == "" {
		return true
	}
	return leftRole == rightRole
}
