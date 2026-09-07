package orchestration

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	corev1 "k8s.io/api/core/v1"
)

const APDefaultAppListeningPort int32 = 80

type APAppListeningPort struct {
	Port int32 `json:"port"`
	// DisplayName is the Port Display Name requested for this port (ADR
	// 0080). It is stored on the AP's Service, never in the desired-network
	// annotation; empty means "no annotation".
	DisplayName string `json:"displayName,omitempty"`
}

func NormalizeAPAppListeningPortsFromNetworkJSON(raw string, fallbackPort int32) ([]APAppListeningPort, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return NormalizeAPAppListeningPortsFromNetwork(nil, fallbackPort)
	}
	var network map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &network); err != nil {
		return nil, err
	}
	return NormalizeAPAppListeningPortsFromNetwork(network, fallbackPort)
}

func NormalizeAPAppListeningPortsFromNetwork(network map[string]interface{}, fallbackPort int32) ([]APAppListeningPort, error) {
	if network != nil {
		if raw, exists := network["appListeningPorts"]; exists {
			rows, ok := raw.([]interface{})
			if !ok {
				return nil, fmt.Errorf("appListeningPorts must be a list")
			}
			ports := make([]APAppListeningPort, 0, len(rows))
			seen := make(map[int32]bool, len(rows))
			seenNames := make(map[string]bool, len(rows))
			for _, row := range rows {
				item, _ := row.(map[string]interface{})
				if item == nil {
					return nil, fmt.Errorf("App Listening Port entries must be objects")
				}
				port, ok := APPortFromInterface(item["port"])
				if !ok {
					return nil, fmt.Errorf("App Listening Port must be an integer from 1 through 65535")
				}
				if seen[port] {
					return nil, fmt.Errorf("App Listening Ports must be unique")
				}
				seen[port] = true
				// Naming never fails a deploy (ADR 0080): an invalid or
				// duplicate name is dropped here; the PATCH route rejects it
				// up front through ValidateAPPortDisplayNames.
				displayName, err := PortDisplayNameValue(item["displayName"])
				if err != nil || seenNames[displayName] {
					displayName = ""
				}
				if displayName != "" {
					seenNames[displayName] = true
				}
				ports = append(ports, APAppListeningPort{DisplayName: displayName, Port: port})
			}
			if len(ports) == 0 {
				return nil, fmt.Errorf("AP must have at least one App Listening Port")
			}
			return ports, nil
		}
		if raw, exists := network["privatePort"]; exists {
			port, ok := APPortFromInterface(raw)
			if !ok {
				return nil, fmt.Errorf("privatePort must be an integer from 1 through 65535")
			}
			return []APAppListeningPort{{Port: port}}, nil
		}
	}
	if IsValidAPPort(fallbackPort) {
		return []APAppListeningPort{{Port: fallbackPort}}, nil
	}
	return []APAppListeningPort{{Port: APDefaultAppListeningPort}}, nil
}

// ValidateAPPortDisplayNames applies the Port Display Name submit rules
// (ADR 0080) to a product network patch: every name is a string of at most
// MaxPortDisplayNameLength characters after trimming, and no two of the AP's
// ports share a name. Empty names are allowed and clear the annotation.
func ValidateAPPortDisplayNames(network map[string]interface{}) error {
	if network == nil {
		return nil
	}
	rows, ok := network["appListeningPorts"].([]interface{})
	if !ok {
		return nil
	}
	seen := make(map[string]bool, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		displayName, err := PortDisplayNameValue(item["displayName"])
		if err != nil {
			return err
		}
		if displayName == "" {
			continue
		}
		if seen[displayName] {
			return fmt.Errorf("Port Display Name %q is used by more than one App Listening Port; each of the AP's ports needs a distinct name", displayName)
		}
		seen[displayName] = true
	}
	return nil
}

// APPortDisplayNameAnnotations renders the per-port Port Display Name
// annotations for the AP's Service (ADR 0080). Ports without a name get no
// entry, so re-applying the Service clears a removed name.
func APPortDisplayNameAnnotations(ports []APAppListeningPort) map[string]string {
	out := map[string]string{}
	for _, port := range ports {
		if name := strings.TrimSpace(port.DisplayName); name != "" {
			out[BrainPortDisplayNameAnnotation(port.Port)] = name
		}
	}
	return out
}

// PreserveAPServicePortDisplayNames carries the Port Display Names already
// stored on the AP's live Service onto a freshly rendered one (ADR 0080). The
// Service is applied as a whole object, so a render that did not name its
// ports would otherwise erase them. Names in the rendered Service win; names
// for ports the Service no longer exposes are dropped with the port.
func PreserveAPServicePortDisplayNames(service *corev1.Service, current map[string]string) {
	if service == nil || len(current) == 0 {
		return
	}
	for _, port := range service.Spec.Ports {
		key := BrainPortDisplayNameAnnotation(port.Port)
		name := strings.TrimSpace(current[key])
		if name == "" {
			continue
		}
		if _, ok := service.Annotations[key]; ok {
			continue
		}
		if service.Annotations == nil {
			service.Annotations = map[string]string{}
		}
		service.Annotations[key] = name
	}
}

// APDesiredNetworkAnnotationValue returns the network JSON to persist in the
// AP desired-network annotation: Port Display Names are removed because the
// Service is their only store (ADR 0080). Anything unparseable is returned
// unchanged so the caller's existing behavior is preserved.
func APDesiredNetworkAnnotationValue(networkJSON string) string {
	trimmed := strings.TrimSpace(networkJSON)
	if trimmed == "" || !strings.Contains(trimmed, "displayName") {
		return networkJSON
	}
	var network map[string]interface{}
	if err := json.Unmarshal([]byte(trimmed), &network); err != nil {
		return networkJSON
	}
	rows, ok := network["appListeningPorts"].([]interface{})
	if !ok {
		return networkJSON
	}
	nextRows := make([]interface{}, 0, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			nextRows = append(nextRows, row)
			continue
		}
		itemCopy := make(map[string]interface{}, len(item))
		for key, value := range item {
			if key == "displayName" {
				continue
			}
			itemCopy[key] = value
		}
		nextRows = append(nextRows, itemCopy)
	}
	network["appListeningPorts"] = nextRows
	out, err := json.Marshal(network)
	if err != nil {
		return networkJSON
	}
	return string(out)
}

func APAppListeningPortRows(ports []APAppListeningPort) []interface{} {
	rows := make([]interface{}, 0, len(ports))
	for _, port := range ports {
		rows = append(rows, map[string]interface{}{"port": port.Port})
	}
	return rows
}

func APAppListeningPortSet(ports []APAppListeningPort) map[int32]bool {
	out := make(map[int32]bool, len(ports))
	for _, port := range ports {
		if IsValidAPPort(port.Port) {
			out[port.Port] = true
		}
	}
	return out
}

func APPortName(port int32) string {
	return fmt.Sprintf("port-%d", port)
}

func IsValidAPPort(port int32) bool {
	return port >= 1 && port <= 65535
}

func APPortFromInterface(value interface{}) (int32, bool) {
	switch typed := value.(type) {
	case int:
		port := int32(typed)
		return port, int64(typed) == int64(port) && IsValidAPPort(port)
	case int32:
		return typed, IsValidAPPort(typed)
	case int64:
		port := int32(typed)
		return port, typed == int64(port) && IsValidAPPort(port)
	case float64:
		port := int32(typed)
		return port, typed == float64(port) && IsValidAPPort(port)
	case json.Number:
		n, err := typed.Int64()
		if err != nil {
			return 0, false
		}
		port := int32(n)
		return port, n == int64(port) && IsValidAPPort(port)
	case string:
		n, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 32)
		if err != nil {
			return 0, false
		}
		port := int32(n)
		return port, n == int64(port) && IsValidAPPort(port)
	default:
		return 0, false
	}
}
