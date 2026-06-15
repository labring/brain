package orchestration

import (
	"regexp"
	"strings"
)

var apPlatformAddressIDPattern = regexp.MustCompile(`^pa_[a-z0-9]{6,32}$`)
var apCustomDomainBindingIDPattern = regexp.MustCompile(`^cd_[a-z0-9]{6,32}$`)

type APNetworkIntent struct {
	AppListeningPorts []APAppListeningPort
	CustomDomains     []APCustomDomainRequest
	PlatformAddresses []APPlatformAddressRequest
}

type APPublicAddressProjectionInput struct {
	APName        string
	Intent        APNetworkIntent
	Namespace     string
	RoutingDomain string
}

func APNetworkIntentFromMap(network map[string]interface{}, fallbackPort int32) (APNetworkIntent, error) {
	ports, err := NormalizeAPAppListeningPortsFromNetwork(network, fallbackPort)
	if err != nil {
		return APNetworkIntent{}, err
	}
	platformAddresses := APPlatformAddressRequestsFromNetwork(network)
	return APNetworkIntent{
		AppListeningPorts: ports,
		CustomDomains:     APCustomDomainRequestsFromNetwork(network, platformAddresses),
		PlatformAddresses: platformAddresses,
	}, nil
}

func APPlatformAddressRequestsFromNetwork(network map[string]interface{}) []APPlatformAddressRequest {
	if network == nil {
		return nil
	}
	rows, ok := network["platformAddresses"].([]interface{})
	if !ok || len(rows) == 0 {
		return nil
	}
	out := make([]APPlatformAddressRequest, 0, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		id, _ := item["id"].(string)
		id = strings.TrimSpace(id)
		port, ok := APPortFromInterface(item["port"])
		if !IsValidAPPlatformAddressID(id) || !ok {
			continue
		}
		domainPrefix, _ := item["domainPrefix"].(string)
		out = append(out, APPlatformAddressRequest{
			DomainPrefix: strings.TrimSpace(strings.ToLower(domainPrefix)),
			ID:           id,
			Port:         port,
		})
	}
	return out
}

func APCustomDomainRequestsFromNetwork(network map[string]interface{}, platformAddresses []APPlatformAddressRequest) []APCustomDomainRequest {
	if network == nil {
		return nil
	}
	rows, ok := network["customDomains"].([]interface{})
	if !ok || len(rows) == 0 {
		return nil
	}
	platformAddressIDs := APPlatformAddressIDSet(platformAddresses)
	out := make([]APCustomDomainRequest, 0, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		id, _ := item["id"].(string)
		id = strings.TrimSpace(id)
		domain, _ := item["domain"].(string)
		domain = strings.Trim(strings.ToLower(strings.TrimSpace(domain)), ".")
		platformAddressID, _ := item["platformAddressId"].(string)
		platformAddressID = strings.TrimSpace(platformAddressID)
		if !IsValidAPCustomDomainBindingID(id) || domain == "" || !platformAddressIDs[platformAddressID] {
			continue
		}
		dns, _ := item["dns"].(map[string]interface{})
		out = append(out, APCustomDomainRequest{
			Domain:            domain,
			DNSStatus:         strings.TrimSpace(strings.ToLower(stringFromInterface(dns["status"]))),
			DNSTarget:         strings.TrimSpace(stringFromInterface(dns["target"])),
			DNSVerifiedAt:     strings.TrimSpace(stringFromInterface(dns["verifiedAt"])),
			ID:                id,
			PlatformAddressID: platformAddressID,
		})
	}
	return out
}

func ProjectAPPublicAddresses(input APPublicAddressProjectionInput) []map[string]interface{} {
	if len(input.Intent.PlatformAddresses) == 0 {
		return nil
	}
	promotedPlatformIDs := map[string]bool{}
	out := make([]map[string]interface{}, 0, len(input.Intent.PlatformAddresses)+len(input.Intent.CustomDomains))
	for _, customDomain := range input.Intent.CustomDomains {
		row, ok := APPublicAddressRowForCustomDomain(input, customDomain)
		if !ok {
			continue
		}
		promotedPlatformIDs[customDomain.PlatformAddressID] = true
		out = append(out, row)
	}
	for _, address := range input.Intent.PlatformAddresses {
		if promotedPlatformIDs[address.ID] {
			continue
		}
		out = append(out, APPublicAddressRowForPlatform(input, address))
	}
	return out
}

func APPublicAddressRowForPlatform(input APPublicAddressProjectionInput, address APPlatformAddressRequest) map[string]interface{} {
	row := map[string]interface{}{
		"id":   address.ID,
		"port": int(address.Port),
		"type": "platform",
	}
	host := PlatformAddressHost(input.Namespace, input.APName, address.ID, address.DomainPrefix, input.RoutingDomain)
	if host != "" {
		row["host"] = host
		row["url"] = "https://" + host + "/"
	}
	if APPublicAddressTargetPortMissing(address.Port, input.Intent.AppListeningPorts) {
		row["reason"] = "target-port-missing"
		row["status"] = "blocked"
	} else {
		row["status"] = "progressing"
	}
	return row
}

func APPublicAddressRowForCustomDomain(input APPublicAddressProjectionInput, customDomain APCustomDomainRequest) (map[string]interface{}, bool) {
	target, ok := APPlatformAddressRequestByID(input.Intent.PlatformAddresses, customDomain.PlatformAddressID)
	if !ok {
		return nil, false
	}
	row := map[string]interface{}{
		"host":              customDomain.Domain,
		"id":                customDomain.ID,
		"platformAddressId": customDomain.PlatformAddressID,
		"port":              int(target.Port),
		"type":              "custom",
		"url":               "https://" + customDomain.Domain + "/",
	}
	cnameTarget := PlatformAddressHost(input.Namespace, input.APName, customDomain.PlatformAddressID, target.DomainPrefix, input.RoutingDomain)
	if cnameTarget != "" {
		row["cnameTarget"] = cnameTarget
	}
	if APPublicAddressTargetPortMissing(target.Port, input.Intent.AppListeningPorts) {
		row["reason"] = "target-port-missing"
		row["status"] = "blocked"
	} else {
		row["status"] = "verifying"
	}
	return row, true
}

func APPublicAddressTargetPortMissing(port int32, appListeningPorts []APAppListeningPort) bool {
	if len(appListeningPorts) == 0 {
		return false
	}
	return !APAppListeningPortSet(appListeningPorts)[port]
}

func APPublicAddressIntentIDs(intent APNetworkIntent) map[string]bool {
	ids := make(map[string]bool, len(intent.PlatformAddresses)+len(intent.CustomDomains))
	for _, address := range intent.PlatformAddresses {
		ids[address.ID] = true
	}
	for _, domain := range intent.CustomDomains {
		ids[domain.ID] = true
	}
	return ids
}

func APPlatformAddressIDSet(addresses []APPlatformAddressRequest) map[string]bool {
	ids := make(map[string]bool, len(addresses))
	for _, address := range addresses {
		ids[address.ID] = true
	}
	return ids
}

func APPlatformAddressRequestByID(addresses []APPlatformAddressRequest, id string) (APPlatformAddressRequest, bool) {
	for _, address := range addresses {
		if address.ID == id {
			return address, true
		}
	}
	return APPlatformAddressRequest{}, false
}

func IsValidAPPlatformAddressID(id string) bool {
	return apPlatformAddressIDPattern.MatchString(strings.TrimSpace(id))
}

func IsValidAPCustomDomainBindingID(id string) bool {
	return apCustomDomainBindingIDPattern.MatchString(strings.TrimSpace(id))
}

func stringFromInterface(value interface{}) string {
	str, _ := value.(string)
	return str
}
