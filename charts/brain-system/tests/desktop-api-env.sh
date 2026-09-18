#!/usr/bin/env bash

set -euo pipefail

chart_dir="${1:-charts/brain-system}"
ui_deployment_name="brain-ui-staging"
api_deployment_name="brain-api-staging"
derived_url="http://sealos-desktop.sealos.svc:3000"
explicit_url="https://desktop.example.test"

deployment_from_manifest() {
  local manifest="$1"
  local deployment_name="$2"

  awk -v deployment_name="$deployment_name" '
    /^---$/ { capture = 0 }
    capture { print }
    $0 == "  name: " deployment_name { capture = 1; print }
  ' <<<"$manifest"
}

desktop_api_value_from_deployment() {
  awk '
    $0 ~ /- name: DESKTOP_API_BASE_URL$/ { found = 1; next }
    found && $0 ~ /^[[:space:]]+value:/ {
      sub(/^[[:space:]]+value:[[:space:]]*/, "")
      gsub(/^"|"$/, "")
      print
      exit
    }
  '
}

default_manifest="$(
  helm template brain-system "$chart_dir" -n brain-system
)"
default_ui_deployment="$(
  deployment_from_manifest "$default_manifest" "$ui_deployment_name"
)"
default_api_deployment="$(
  deployment_from_manifest "$default_manifest" "$api_deployment_name"
)"
default_value="$(
  desktop_api_value_from_deployment <<<"$default_ui_deployment"
)"

if [[ "$default_value" != "$derived_url" ]]; then
  echo "Expected UI DESKTOP_API_BASE_URL to derive to $derived_url, got: ${default_value:-<missing>}" >&2
  exit 1
fi
if grep -q 'DESKTOP_API_BASE_URL' <<<"$default_api_deployment"; then
  echo "DESKTOP_API_BASE_URL must be owned by the UI deployment, not the API deployment" >&2
  exit 1
fi

explicit_manifest="$(
  helm template brain-system "$chart_dir" -n brain-system \
    --set-string "ui.env.DESKTOP_API_BASE_URL=$explicit_url"
)"
explicit_ui_deployment="$(
  deployment_from_manifest "$explicit_manifest" "$ui_deployment_name"
)"
explicit_value="$(
  desktop_api_value_from_deployment <<<"$explicit_ui_deployment"
)"

if [[ "$explicit_value" != "$explicit_url" ]]; then
  echo "Expected explicit UI DESKTOP_API_BASE_URL to remain $explicit_url, got: ${explicit_value:-<missing>}" >&2
  exit 1
fi
