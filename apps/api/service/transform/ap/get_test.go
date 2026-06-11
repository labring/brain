package ap

import (
	"fmt"
	"strconv"
	"testing"
)

func TestAPTransformEnrichesPrivateNetworkFromService(t *testing.T) {
	tests := []struct {
		name        string
		privatePort int
		wantAddress string
	}{
		{
			name:        "default http port",
			privatePort: 80,
			wantAddress: "http://api-service-port-80.default.svc.cluster.local",
		},
		{
			name:        "non-default port",
			privatePort: 8080,
			wantAddress: "http://api-service-port-8080.default.svc.cluster.local:8080",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := APWithIngressesAndServicesFromList(
				map[string]interface{}{
					"metadata": map[string]interface{}{
						"name":      "api",
						"namespace": "default",
					},
					"spec": map[string]interface{}{
						"input": map[string]interface{}{
							"network": map[string]interface{}{
								"privatePort": tt.privatePort,
							},
						},
					},
				},
				nil,
				[]map[string]interface{}{
					{
						"metadata": map[string]interface{}{
							"name":      "api-service-port-" + intString(tt.privatePort),
							"namespace": "default",
						},
						"spec": map[string]interface{}{
							"ports": []interface{}{
								map[string]interface{}{"port": tt.privatePort},
							},
						},
					},
				},
			)

			status := out["status"].(map[string]interface{})
			network := status["network"].(map[string]interface{})
			if got := network["privatePort"]; got != tt.privatePort {
				t.Fatalf("status.network.privatePort = %v, want %d", got, tt.privatePort)
			}
			if got := network["privateAddress"]; got != tt.wantAddress {
				t.Fatalf("status.network.privateAddress = %v, want %s", got, tt.wantAddress)
			}
			rows := network["appListeningPorts"].([]interface{})
			row := rows[0].(map[string]interface{})
			if got := row["port"]; got != tt.privatePort {
				t.Fatalf("status.network.appListeningPorts[0].port = %v, want %d", got, tt.privatePort)
			}
			if got := row["privateAddress"]; got != tt.wantAddress {
				t.Fatalf("status.network.appListeningPorts[0].privateAddress = %v, want %s", got, tt.wantAddress)
			}
		})
	}
}

func TestAPTransformEnrichesMultipleAppListeningPortsFromService(t *testing.T) {
	out := APWithIngressesAndServicesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"appListeningPorts": []interface{}{
							map[string]interface{}{"port": 80},
							map[string]interface{}{"port": 3000},
						},
					},
				},
			},
		},
		nil,
		[]map[string]interface{}{
			{
				"metadata": map[string]interface{}{
					"name":      "api-service",
					"namespace": "default",
				},
				"spec": map[string]interface{}{
					"ports": []interface{}{
						map[string]interface{}{"port": 80},
						map[string]interface{}{"port": 3000},
					},
				},
			},
		},
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	rows := network["appListeningPorts"].([]interface{})
	if got := len(rows); got != 2 {
		t.Fatalf("status.network.appListeningPorts count = %d, want 2", got)
	}
	first := rows[0].(map[string]interface{})
	second := rows[1].(map[string]interface{})
	if got := first["privateAddress"]; got != "http://api-service.default.svc.cluster.local" {
		t.Fatalf("port 80 privateAddress = %v, want service URL without :80", got)
	}
	if got := second["privateAddress"]; got != "http://api-service.default.svc.cluster.local:3000" {
		t.Fatalf("port 3000 privateAddress = %v, want service URL with port", got)
	}
}

func TestAPTransformPreservesExistingPrivateNetworkAddress(t *testing.T) {
	out := APWithIngressesAndServicesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"privatePort": 8080,
					},
				},
			},
			"status": map[string]interface{}{
				"network": map[string]interface{}{
					"privateAddress": "http://api.default.svc:8080",
					"privatePort":    8080,
				},
			},
		},
		nil,
		[]map[string]interface{}{
			{
				"metadata": map[string]interface{}{
					"name":      "api-service-port-8080",
					"namespace": "default",
				},
				"spec": map[string]interface{}{
					"ports": []interface{}{
						map[string]interface{}{"port": 8080},
					},
				},
			},
		},
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	if got := network["privateAddress"]; got != "http://api.default.svc:8080" {
		t.Fatalf("status.network.privateAddress = %v, want preserved address", got)
	}
}

func TestAPTransformMergesObservedAndPendingPlatformAddresses(t *testing.T) {
	out := APWithIngressesAndServicesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"privatePort": 8080,
						"platformAddresses": []interface{}{
							map[string]interface{}{"id": "pa_abc123", "port": 8080},
							map[string]interface{}{"id": "pa_def456", "port": 8080},
						},
					},
				},
			},
			"status": map[string]interface{}{
				"phase": "Running",
				"network": map[string]interface{}{
					"publicAddresses": []interface{}{
						map[string]interface{}{
							"host":   "api.example.com",
							"id":     "pa_abc123",
							"port":   8080,
							"status": "accessible",
							"type":   "platform",
							"url":    "https://api.example.com/",
						},
					},
				},
			},
		},
		nil,
		nil,
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	addresses := network["publicAddresses"].([]map[string]interface{})
	if got := len(addresses); got != 2 {
		t.Fatalf("status.network.publicAddresses count = %d, want 2", got)
	}
	assertPublicNetworkAddress(t, addresses, "api.example.com", "https://api.example.com/", 8080)
	assertPendingPublicNetworkAddress(t, addresses, "pa_def456", 8080)
}

func TestAPTransformEnrichesPendingPublicAddressesFromDesiredPlatformAddresses(t *testing.T) {
	out := APWithIngressesAndServicesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"labels":    map[string]interface{}{"region": "apps.example.com"},
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"privatePort": 8080,
						"platformAddresses": []interface{}{
							map[string]interface{}{"id": "pa_abc123", "port": 8080},
							map[string]interface{}{"id": "pa_def456", "port": 8080},
							map[string]interface{}{"port": 9000},
						},
					},
				},
			},
			"status": map[string]interface{}{
				"phase": "Progressing",
			},
		},
		nil,
		nil,
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	addresses := network["publicAddresses"].([]map[string]interface{})
	if got := len(addresses); got != 2 {
		t.Fatalf("status.network.publicAddresses count = %d, want 2", got)
	}
	assertPendingPublicNetworkAddressWithHost(t, addresses, "pa_abc123", "ucflzg.apps.example.com", 8080)
	assertPendingPublicNetworkAddressWithHost(t, addresses, "pa_def456", "hndpda.apps.example.com", 8080)
}

func TestAPTransformPendingPlatformAddressHostIgnoresUIDAndTargetPort(t *testing.T) {
	out := APWithIngressesAndServicesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"labels":    map[string]interface{}{"region": "apps.example.com"},
				"name":      "api",
				"namespace": "default",
				"uid":       "ap-uid-1",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"privatePort": 8080,
						"platformAddresses": []interface{}{
							map[string]interface{}{"id": "pa_abc123", "port": 9000},
						},
					},
				},
			},
		},
		nil,
		nil,
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	addresses := network["publicAddresses"].([]map[string]interface{})
	assertBlockedPublicNetworkAddressWithHost(t, addresses, "pa_abc123", "ucflzg.apps.example.com", 9000)
}

func TestAPTransformPromotesDesiredCustomDomainRows(t *testing.T) {
	out := APWithIngressesAndServicesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"labels":    map[string]interface{}{"region": "apps.example.com"},
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"appListeningPorts": []interface{}{
							map[string]interface{}{"port": 8080},
							map[string]interface{}{"port": 9000},
						},
						"privatePort": 8080,
						"platformAddresses": []interface{}{
							map[string]interface{}{"id": "pa_abc123", "port": 8080},
							map[string]interface{}{"id": "pa_def456", "port": 9000},
						},
						"customDomains": []interface{}{
							map[string]interface{}{
								"domain":            "WWW.Example.COM.",
								"id":                "cd_def456",
								"platformAddressId": "pa_abc123",
							},
						},
					},
				},
			},
		},
		nil,
		nil,
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	addresses := network["publicAddresses"].([]map[string]interface{})
	if got := len(addresses); got != 2 {
		t.Fatalf("status.network.publicAddresses count = %d, want 2", got)
	}
	assertCustomDomainPublicNetworkAddress(t, addresses, "cd_def456", "www.example.com", "pa_abc123", "ucflzg.apps.example.com", 8080)
	assertPendingPublicNetworkAddressWithHost(t, addresses, "pa_def456", "hndpda.apps.example.com", 9000)
	assertPublicNetworkAddressIDMissing(t, addresses, "pa_abc123")
}

func TestAPTransformObservedCustomDomainHidesPromotedPlatformAddress(t *testing.T) {
	out := APWithIngressesAndServicesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"labels":    map[string]interface{}{"region": "apps.example.com"},
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"appListeningPorts": []interface{}{
							map[string]interface{}{"port": 8080},
							map[string]interface{}{"port": 9000},
						},
						"privatePort": 8080,
						"platformAddresses": []interface{}{
							map[string]interface{}{"id": "pa_abc123", "port": 8080},
							map[string]interface{}{"id": "pa_def456", "port": 9000},
						},
						"customDomains": []interface{}{
							map[string]interface{}{
								"domain":            "www.example.com",
								"id":                "cd_def456",
								"platformAddressId": "pa_abc123",
							},
						},
					},
				},
			},
			"status": map[string]interface{}{
				"network": map[string]interface{}{
					"publicAddresses": []interface{}{
						map[string]interface{}{
							"host":   "ucflzg.apps.example.com",
							"id":     "pa_abc123",
							"port":   8080,
							"status": "accessible",
							"type":   "platform",
							"url":    "https://ucflzg.apps.example.com/",
						},
						map[string]interface{}{
							"cnameTarget":       "ucflzg.apps.example.com",
							"host":              "www.example.com",
							"id":                "cd_def456",
							"platformAddressId": "pa_abc123",
							"port":              8080,
							"status":            "pending",
							"type":              "custom",
							"url":               "https://www.example.com/",
						},
					},
				},
			},
		},
		nil,
		nil,
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	addresses := network["publicAddresses"].([]map[string]interface{})
	if got := len(addresses); got != 2 {
		t.Fatalf("status.network.publicAddresses count = %d, want 2", got)
	}
	assertCustomDomainPublicNetworkAddress(t, addresses, "cd_def456", "www.example.com", "pa_abc123", "ucflzg.apps.example.com", 8080)
	assertPendingPublicNetworkAddressWithHost(t, addresses, "pa_def456", "hndpda.apps.example.com", 9000)
	assertPublicNetworkAddressIDMissing(t, addresses, "pa_abc123")
}

func TestAPTransformProjectsPlatformAddressAccessibleFromSupportIngress(t *testing.T) {
	out := APWithPublicAccessSupportResourcesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"labels":    map[string]interface{}{"region": "apps.example.com"},
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"appListeningPorts": []interface{}{
							map[string]interface{}{"port": 8080},
						},
						"platformAddresses": []interface{}{
							map[string]interface{}{"id": "pa_abc123", "port": 8080},
						},
					},
				},
			},
		},
		[]map[string]interface{}{
			publicAccessIngress("api", "pa_abc123", "platform", "ucflzg.apps.example.com", "api-service", 8080),
		},
		nil,
		nil,
		nil,
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	addresses := network["publicAddresses"].([]map[string]interface{})
	assertPublicNetworkAddress(t, addresses, "ucflzg.apps.example.com", "https://ucflzg.apps.example.com/", 8080)
}

func TestAPTransformProjectsCustomDomainAccessibleFromSupportResources(t *testing.T) {
	out := APWithPublicAccessSupportResourcesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"labels":    map[string]interface{}{"region": "apps.example.com"},
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"appListeningPorts": []interface{}{
							map[string]interface{}{"port": 8080},
						},
						"platformAddresses": []interface{}{
							map[string]interface{}{"id": "pa_abc123", "port": 8080},
						},
						"customDomains": []interface{}{
							map[string]interface{}{
								"dns": map[string]interface{}{
									"status":     "verified",
									"target":     "ucflzg.apps.example.com",
									"verifiedAt": "2026-06-12T00:00:00Z",
								},
								"domain":            "www.example.com",
								"id":                "cd_def456",
								"platformAddressId": "pa_abc123",
							},
						},
					},
				},
			},
		},
		[]map[string]interface{}{
			publicAccessIngress("api", "cd_def456", "custom-domain", "www.example.com", "api-service", 8080),
		},
		nil,
		[]map[string]interface{}{
			publicAccessCertificate("api", "cd_def456", true, "", ""),
		},
		nil,
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	addresses := network["publicAddresses"].([]map[string]interface{})
	for _, address := range addresses {
		if address["id"] != "cd_def456" {
			continue
		}
		if got := address["status"]; got != "accessible" {
			t.Fatalf("custom domain status = %v, want accessible", got)
		}
		dns := address["dns"].(map[string]interface{})
		if got := dns["status"]; got != "verified" {
			t.Fatalf("dns status = %v, want verified", got)
		}
		certificate := address["certificate"].(map[string]interface{})
		if got := certificate["status"]; got != "ready" {
			t.Fatalf("certificate status = %v, want ready", got)
		}
		routing := address["routing"].(map[string]interface{})
		if got := routing["status"]; got != "ready" {
			t.Fatalf("routing status = %v, want ready", got)
		}
		return
	}
	t.Fatal("missing custom domain public address")
}

func TestAPTransformBlocksCustomDomainWhenTargetPortMissing(t *testing.T) {
	out := APWithIngressesAndServicesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"labels":    map[string]interface{}{"region": "apps.example.com"},
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"appListeningPorts": []interface{}{
							map[string]interface{}{"port": 8080},
						},
						"platformAddresses": []interface{}{
							map[string]interface{}{"id": "pa_abc123", "port": 9000},
						},
						"customDomains": []interface{}{
							map[string]interface{}{
								"domain":            "www.example.com",
								"id":                "cd_def456",
								"platformAddressId": "pa_abc123",
							},
						},
					},
				},
			},
		},
		nil,
		nil,
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	addresses := network["publicAddresses"].([]map[string]interface{})
	if got := len(addresses); got != 1 {
		t.Fatalf("status.network.publicAddresses count = %d, want blocked custom row only", got)
	}
	assertBlockedCustomDomainPublicNetworkAddress(t, addresses, "cd_def456", "www.example.com", "pa_abc123", "ucflzg.apps.example.com", 9000)
	assertPublicNetworkAddressIDMissing(t, addresses, "pa_abc123")
}

func TestAPTransformLeavesDesiredPlatformAddressHostPendingWhenInputsAreMissing(t *testing.T) {
	out := APWithIngressesAndServicesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"input": map[string]interface{}{
					"network": map[string]interface{}{
						"privatePort": 8080,
						"platformAddresses": []interface{}{
							map[string]interface{}{"id": "pa_abc123", "port": 8080},
						},
					},
				},
			},
		},
		nil,
		nil,
	)

	status := out["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	addresses := network["publicAddresses"].([]map[string]interface{})
	assertPendingPublicNetworkAddress(t, addresses, "pa_abc123", 8080)
}

func TestAPTransformDoesNotInferNetworkFromRetiredSpecEndpoints(t *testing.T) {
	out := APWithIngressesAndServicesFromList(
		map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "api",
				"namespace": "default",
			},
			"spec": map[string]interface{}{
				"endpoints": []interface{}{
					map[string]interface{}{"host": "api.example.com", "port": 8080},
				},
			},
		},
		[]map[string]interface{}{
			{
				"metadata": map[string]interface{}{
					"name":      "api-ingress",
					"namespace": "default",
				},
				"spec": map[string]interface{}{
					"rules": []interface{}{
						ingressRule("api.example.com", "api-service", 8080),
					},
				},
			},
		},
		nil,
	)

	status := out["status"].(map[string]interface{})
	if got := status["variables"]; got != nil {
		t.Fatalf("status.variables from retired spec endpoints = %v, want nil", got)
	}
	if _, ok := status["network"]; ok {
		t.Fatal("status.network should not be inferred from retired spec endpoints")
	}
}

func TestAPTransformIgnoresInvalidPrivateNetworkPort(t *testing.T) {
	for _, privatePort := range []interface{}{0, 65536, 8080.5} {
		t.Run(fmt.Sprint(privatePort), func(t *testing.T) {
			out := APWithIngressesAndServicesFromList(
				map[string]interface{}{
					"metadata": map[string]interface{}{
						"name":      "api",
						"namespace": "default",
					},
					"spec": map[string]interface{}{
						"input": map[string]interface{}{
							"network": map[string]interface{}{
								"privatePort": privatePort,
							},
						},
					},
				},
				nil,
				[]map[string]interface{}{
					{
						"metadata": map[string]interface{}{
							"name":      "api-service-port-8080",
							"namespace": "default",
						},
						"spec": map[string]interface{}{
							"ports": []interface{}{
								map[string]interface{}{"port": 8080},
							},
						},
					},
				},
			)

			status := out["status"].(map[string]interface{})
			if _, ok := status["network"]; ok {
				t.Fatalf("status.network exists for invalid privatePort %v", privatePort)
			}
		})
	}
}

func intString(n int) string {
	return strconv.Itoa(n)
}

func ingressRule(host string, serviceName string, port int) map[string]interface{} {
	return map[string]interface{}{
		"host": host,
		"http": map[string]interface{}{
			"paths": []interface{}{
				map[string]interface{}{
					"backend": map[string]interface{}{
						"service": map[string]interface{}{
							"name": serviceName,
							"port": map[string]interface{}{"number": port},
						},
					},
					"path": "/",
				},
			},
		},
	}
}

func publicAccessIngress(apName, publicID, publicKind, host, serviceName string, port int) map[string]interface{} {
	return map[string]interface{}{
		"metadata": map[string]interface{}{
			"labels": map[string]interface{}{
				"brain.io/app-name":            apName,
				"brain.io/public-address-id":   publicID,
				"brain.io/public-address-kind": publicKind,
				"brain.io/resource-kind":       "public-access-support",
			},
		},
		"spec": map[string]interface{}{
			"rules": []interface{}{
				ingressRule(host, serviceName, port),
			},
		},
	}
}

func publicAccessCertificate(apName, id string, ready bool, reason string, message string) map[string]interface{} {
	status := "False"
	if ready {
		status = "True"
	}
	condition := map[string]interface{}{"type": "Ready", "status": status}
	if reason != "" {
		condition["reason"] = reason
	}
	if message != "" {
		condition["message"] = message
	}
	return map[string]interface{}{
		"metadata": map[string]interface{}{
			"labels": map[string]interface{}{
				"brain.io/app-name":      apName,
				"brain.io/resource-kind": "public-access-support",
			},
			"name": "cd-" + stablePlatformAddressHostLabel("api/"+id, 6),
		},
		"status": map[string]interface{}{
			"conditions": []interface{}{condition},
		},
	}
}

func assertPublicNetworkAddress(t *testing.T, addresses []map[string]interface{}, host string, url string, port int) {
	t.Helper()
	for _, address := range addresses {
		if address["host"] != host {
			continue
		}
		if got := address["url"]; got != url {
			t.Fatalf("public address %s url = %v, want %s", host, got, url)
		}
		if got := address["port"]; got != port {
			t.Fatalf("public address %s port = %v, want %d", host, got, port)
		}
		if got := address["type"]; got != "platform" {
			t.Fatalf("public address %s type = %v, want platform", host, got)
		}
		if got := address["status"]; got != "accessible" {
			t.Fatalf("public address %s status = %v, want accessible", host, got)
		}
		return
	}
	t.Fatalf("missing public address for host %s", host)
}

func assertPendingPublicNetworkAddress(t *testing.T, addresses []map[string]interface{}, id string, port int) {
	t.Helper()
	for _, address := range addresses {
		if address["id"] != id {
			continue
		}
		if _, ok := address["host"]; ok {
			t.Fatalf("pending public address %s has host = %v, want absent", id, address["host"])
		}
		if _, ok := address["url"]; ok {
			t.Fatalf("pending public address %s has url = %v, want absent", id, address["url"])
		}
		if got := address["port"]; got != port {
			t.Fatalf("pending public address %s port = %v, want %d", id, got, port)
		}
		if got := address["type"]; got != "platform" {
			t.Fatalf("pending public address %s type = %v, want platform", id, got)
		}
		if got := address["status"]; got != "progressing" {
			t.Fatalf("pending public address %s status = %v, want progressing", id, got)
		}
		return
	}
	t.Fatalf("missing pending public address for id %s", id)
}

func assertCustomDomainPublicNetworkAddress(t *testing.T, addresses []map[string]interface{}, id string, domain string, platformAddressID string, cnameTarget string, port int) {
	t.Helper()
	for _, address := range addresses {
		if address["id"] != id {
			continue
		}
		if got := address["host"]; got != domain {
			t.Fatalf("custom domain address %s host = %v, want %s", id, got, domain)
		}
		if got := address["url"]; got != fmt.Sprintf("https://%s/", domain) {
			t.Fatalf("custom domain address %s url = %v, want host URL", id, got)
		}
		if got := address["platformAddressId"]; got != platformAddressID {
			t.Fatalf("custom domain address %s platformAddressId = %v, want %s", id, got, platformAddressID)
		}
		if got := address["cnameTarget"]; got != cnameTarget {
			t.Fatalf("custom domain address %s cnameTarget = %v, want %s", id, got, cnameTarget)
		}
		if got := address["port"]; got != port {
			t.Fatalf("custom domain address %s port = %v, want %d", id, got, port)
		}
		if got := address["type"]; got != "custom" {
			t.Fatalf("custom domain address %s type = %v, want custom", id, got)
		}
		if got := address["status"]; got != "verifying" {
			t.Fatalf("custom domain address %s status = %v, want verifying", id, got)
		}
		return
	}
	t.Fatalf("missing custom domain address for id %s", id)
}

func assertPublicNetworkAddressIDMissing(t *testing.T, addresses []map[string]interface{}, id string) {
	t.Helper()
	for _, address := range addresses {
		if address["id"] == id {
			t.Fatalf("public address id %s should be hidden after Custom Domain promotion", id)
		}
	}
}

func assertPendingPublicNetworkAddressWithHost(t *testing.T, addresses []map[string]interface{}, id string, host string, port int) {
	t.Helper()
	for _, address := range addresses {
		if address["id"] != id {
			continue
		}
		if got := address["host"]; got != host {
			t.Fatalf("pending public address %s host = %v, want %s", id, got, host)
		}
		if got := address["url"]; got != fmt.Sprintf("https://%s/", host) {
			t.Fatalf("pending public address %s url = %v, want host URL", id, got)
		}
		if got := address["port"]; got != port {
			t.Fatalf("pending public address %s port = %v, want %d", id, got, port)
		}
		if got := address["type"]; got != "platform" {
			t.Fatalf("pending public address %s type = %v, want platform", id, got)
		}
		if got := address["status"]; got != "progressing" {
			t.Fatalf("pending public address %s status = %v, want progressing", id, got)
		}
		return
	}
	t.Fatalf("missing pending public address for id %s", id)
}

func assertBlockedPublicNetworkAddressWithHost(t *testing.T, addresses []map[string]interface{}, id string, host string, port int) {
	t.Helper()
	for _, address := range addresses {
		if address["id"] != id {
			continue
		}
		if got := address["host"]; got != host {
			t.Fatalf("blocked public address %s host = %v, want %s", id, got, host)
		}
		if got := address["url"]; got != fmt.Sprintf("https://%s/", host) {
			t.Fatalf("blocked public address %s url = %v, want host URL", id, got)
		}
		if got := address["port"]; got != port {
			t.Fatalf("blocked public address %s port = %v, want %d", id, got, port)
		}
		if got := address["type"]; got != "platform" {
			t.Fatalf("blocked public address %s type = %v, want platform", id, got)
		}
		if got := address["status"]; got != "blocked" {
			t.Fatalf("blocked public address %s status = %v, want blocked", id, got)
		}
		if got := address["reason"]; got != "target-port-missing" {
			t.Fatalf("blocked public address %s reason = %v, want target-port-missing", id, got)
		}
		return
	}
	t.Fatalf("missing blocked public address for id %s", id)
}

func assertBlockedCustomDomainPublicNetworkAddress(t *testing.T, addresses []map[string]interface{}, id string, domain string, platformAddressID string, cnameTarget string, port int) {
	t.Helper()
	for _, address := range addresses {
		if address["id"] != id {
			continue
		}
		if got := address["host"]; got != domain {
			t.Fatalf("blocked custom domain address %s host = %v, want %s", id, got, domain)
		}
		if got := address["url"]; got != fmt.Sprintf("https://%s/", domain) {
			t.Fatalf("blocked custom domain address %s url = %v, want host URL", id, got)
		}
		if got := address["platformAddressId"]; got != platformAddressID {
			t.Fatalf("blocked custom domain address %s platformAddressId = %v, want %s", id, got, platformAddressID)
		}
		if got := address["cnameTarget"]; got != cnameTarget {
			t.Fatalf("blocked custom domain address %s cnameTarget = %v, want %s", id, got, cnameTarget)
		}
		if got := address["port"]; got != port {
			t.Fatalf("blocked custom domain address %s port = %v, want %d", id, got, port)
		}
		if got := address["type"]; got != "custom" {
			t.Fatalf("blocked custom domain address %s type = %v, want custom", id, got)
		}
		if got := address["status"]; got != "blocked" {
			t.Fatalf("blocked custom domain address %s status = %v, want blocked", id, got)
		}
		if got := address["reason"]; got != "target-port-missing" {
			t.Fatalf("blocked custom domain address %s reason = %v, want target-port-missing", id, got)
		}
		return
	}
	t.Fatalf("missing blocked custom domain address for id %s", id)
}
