#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

RELEASE="${RELEASE:-brain-system}"
NAMESPACE="${NAMESPACE:-brain-system}"
CHART_DIR="${CHART_DIR:-${REPO_ROOT}/charts/brain-system}"
VALUES_FILE="${1:-${VALUES_FILE:-}}"
HELM_OPTS="${HELM_OPTS:-}"

config_namespace="${SEALOS_CONFIG_NAMESPACE:-sealos-system}"
config_name="${SEALOS_CONFIG_NAME:-sealos-config}"

cloud_domain="$(kubectl get configmap "${config_name}" -n "${config_namespace}" -o jsonpath='{.data.cloudDomain}')"
cloud_port="$(kubectl get configmap "${config_name}" -n "${config_namespace}" -o jsonpath='{.data.cloudPort}' 2>/dev/null || true)"

if [[ -z "${cloud_domain}" ]]; then
  echo "cloudDomain is empty in ${config_namespace}/${config_name}" >&2
  exit 1
fi

value_args=()
if [[ -n "${VALUES_FILE}" ]]; then
  value_args=(-f "${VALUES_FILE}")
fi

helm upgrade --install "${RELEASE}" "${CHART_DIR}" \
  -n "${NAMESPACE}" \
  --create-namespace \
  "${value_args[@]}" \
  --set-string "global.cloudDomain=${cloud_domain}" \
  --set-string "global.cloudPort=${cloud_port}" \
  --disable-openapi-validation \
  --wait=watcher \
  --timeout=15m \
  ${HELM_OPTS}
