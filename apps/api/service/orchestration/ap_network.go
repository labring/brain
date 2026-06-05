package orchestration

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

const APDefaultAppListeningPort int32 = 80

type APAppListeningPort struct {
	Port int32 `json:"port"`
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
				ports = append(ports, APAppListeningPort{Port: port})
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
