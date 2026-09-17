package ap

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func networkProtocolFixture(t *testing.T, raw string) map[string]interface{} {
	t.Helper()
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestAPNetworkMatchesLaunchpadProtocolsAndPorts(t *testing.T) {
	for _, secure := range []bool{false, true} {
		for _, named := range []bool{false, true} {
			t.Run(fmt.Sprintf("secure=%v/named=%v", secure, named), func(t *testing.T) {
				service := networkProtocolFixture(t, `{"metadata":{"name":"game-service","namespace":"demo"},"spec":{"ports":[{"port":5200,"name":"game"},{"port":5201,"name":"admin"}]}}`)
				ingress := func(port int, protocol string) map[string]interface{} {
					backendPort := fmt.Sprintf(`{"number":%d}`, port)
					if named {
						name := "game"
						if port == 5201 {
							name = "admin"
						}
						backendPort = fmt.Sprintf(`{"name":%q}`, name)
					}
					tls := ""
					if secure {
						tls = `"tls":[{"hosts":["game.example.com"]}],`
					}
					return networkProtocolFixture(t, fmt.Sprintf(`{"metadata":{"name":"entry-%d","namespace":"demo","annotations":{"nginx.ingress.kubernetes.io/backend-protocol":%q}},"spec":{%s"rules":[{"host":"game.example.com","http":{"paths":[{"path":"/","backend":{"service":{"name":"game-service","port":%s}}}]}}]}}`, port, protocol, tls, backendPort))
				}
				ap := networkProtocolFixture(t, `{"metadata":{"name":"game","namespace":"demo"},"spec":{"input":{"network":{"appListeningPorts":[{"port":5200},{"port":5201}]}}},"status":{"network":{"privatePort":5200,"privateAddress":"http://game-service.demo.svc.cluster.local:5200","appListeningPorts":[{"port":5200,"privateAddress":"http://game-service.demo.svc.cluster.local:5200"},{"port":5201,"privateAddress":"http://game-service.demo.svc.cluster.local:5201"}]}}}`)
				before, _ := json.Marshal(ap)
				game, admin := ingress(5200, "WS"), ingress(5201, "HTTP")
				for _, ingresses := range [][]map[string]interface{}{{game, admin, game}, {admin, game}} {
					out := APWithIngressesAndServicesFromList(ap, ingresses, []map[string]interface{}{service})
					network := out["status"].(map[string]interface{})["network"].(map[string]interface{})
					addresses := publicAddressRowsFromValue(network["publicAddresses"])
					urlsByPort := map[int]map[string]bool{}
					for _, address := range addresses {
						port, _ := privatePortFromValue(address["port"])
						url, _ := address["url"].(string)
						if urlsByPort[port] == nil {
							urlsByPort[port] = map[string]bool{}
						}
						urlsByPort[port][url] = true
					}
					web, socket := "http://game.example.com/", "ws://game.example.com/"
					if secure {
						web, socket = "https://game.example.com/", "wss://game.example.com/"
					}
					if !urlsByPort[5200][web] || !urlsByPort[5200][socket] {
						t.Fatalf("port 5200: %v, want both %s and %s", urlsByPort[5200], web, socket)
					}
					if !urlsByPort[5201][web] || urlsByPort[5201][socket] {
						t.Fatalf("port 5201: %v, want only %s", urlsByPort[5201], web)
					}
					rows := network["appListeningPorts"].([]interface{})
					if rows[0].(map[string]interface{})["privateAddress"] != "ws://game-service.demo.svc.cluster.local:5200" {
						t.Fatal(rows)
					}
					if rows[1].(map[string]interface{})["privateAddress"] != "http://game-service.demo.svc.cluster.local:5201" {
						t.Fatal(rows)
					}
					if network["privateAddress"] != rows[0].(map[string]interface{})["privateAddress"] {
						t.Fatal("primary address was not corrected")
					}
					for _, variable := range out["status"].(map[string]interface{})["variables"].([]map[string]interface{}) {
						if variable["name"] == "port-5200-internal" && variable["value"] != "ws://game-service.demo.svc.cluster.local:5200" {
							t.Fatal("legacy connection variable disagrees with network", variable)
						}
					}
				}
				after, _ := json.Marshal(ap)
				if string(before) != string(after) {
					t.Fatal("projection mutated source state")
				}
			})
		}
	}
}

func TestAPNetworkMergesObservedPortsIntoExistingAddressState(t *testing.T) {
	status := networkProtocolFixture(t, `{"network":{"publicAddresses":[{"id":"existing","host":"game.example.com","port":5200,"status":"blocked","url":"https://game.example.com/"}]}}`)
	service := networkProtocolFixture(t, `{"metadata":{"name":"game-service","namespace":"demo"},"spec":{"ports":[{"port":5200},{"port":5201}]}}`)
	ingress := networkProtocolFixture(t, `{"spec":{"rules":[{"host":"game.example.com","http":{"paths":[{"backend":{"service":{"name":"game-service","port":{"number":5200}}}},{"backend":{"service":{"name":"game-service","port":{"number":5201}}}}]}}]}}`)
	mergeObservedPublicAccessStatus(status, []map[string]interface{}{ingress}, []map[string]interface{}{service})
	addresses := publicAddressRowsFromValue(status["network"].(map[string]interface{})["publicAddresses"])
	if len(addresses) != 2 || addresses[0]["id"] != "existing" || addresses[0]["status"] != "blocked" {
		t.Fatal("existing entry must not hide a second port or change health", addresses)
	}
}

func TestAPNetworkDoesNotInventWebSocketWithoutRoutingEvidence(t *testing.T) {
	status := networkProtocolFixture(t, `{"network":{"privatePort":5200,"appListeningPorts":[{"port":5200,"privateAddress":"http://game-service.demo.svc.cluster.local:5200"}]}}`)
	service := networkProtocolFixture(t, `{"metadata":{"name":"game-service","namespace":"demo"},"spec":{"ports":[{"port":5200}]}}`)
	projectObservedNetworkProtocols(status, nil, []map[string]interface{}{service})
	raw, _ := json.Marshal(status)
	if strings.Contains(string(raw), "ws://") || strings.Contains(string(raw), "publicAddresses") {
		t.Fatal(string(raw))
	}
}

func TestAPNetworkKeepsHttpsWhenAddingObservedWebSocketSibling(t *testing.T) {
	status := networkProtocolFixture(t, `{"network":{"publicAddresses":[{"id":"existing","host":"game.example.com","port":5200,"status":"blocked","url":"https://game.example.com/socket?version=2"}]}}`)
	service := networkProtocolFixture(t, `{"metadata":{"name":"game-service","namespace":"demo"},"spec":{"ports":[{"port":5200},{"port":5201}]}}`)
	ingress := networkProtocolFixture(t, `{"metadata":{"annotations":{"nginx.ingress.kubernetes.io/backend-protocol":"WS"}},"spec":{"tls":[{"hosts":["game.example.com"]}],"rules":[{"host":"game.example.com","http":{"paths":[{"backend":{"service":{"name":"game-service","port":{"number":5200}}}}]}}]}}`)
	projectObservedNetworkProtocols(status, []map[string]interface{}{ingress}, []map[string]interface{}{service})
	addresses := publicAddressRowsFromValue(status["network"].(map[string]interface{})["publicAddresses"])
	urls := map[string]map[string]interface{}{}
	for _, address := range addresses {
		url, _ := address["url"].(string)
		urls[url] = address
	}
	existing := urls["https://game.example.com/socket?version=2"]
	if existing == nil || existing["status"] != "blocked" || existing["id"] != "existing" {
		t.Fatal("HTTPS Public Address must stay, including health and identity", addresses)
	}
	if urls["wss://game.example.com/"] == nil {
		t.Fatal("WS-marked Ingress must add a WebSocket sibling, not replace HTTPS", addresses)
	}
	before, _ := json.Marshal(status)
	projectObservedNetworkProtocols(status, []map[string]interface{}{ingress}, []map[string]interface{}{service})
	after, _ := json.Marshal(status)
	if string(before) != string(after) {
		t.Fatal("projection is not idempotent")
	}
}
