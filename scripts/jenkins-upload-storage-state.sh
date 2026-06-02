#!/usr/bin/env bash
# Upload .auth/naukri-state.json as Jenkins secret file NAUKRI_STORAGE_STATE
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_FILE="${1:-${ROOT}/.auth/naukri-state.json}"
JENKINS_URL="${JENKINS_URL:-http://127.0.0.1:8080}"
JENKINS_USER="${JENKINS_USER:-ajay}"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "Missing session file: $STATE_FILE — run: npm run save-session"
  exit 1
fi

if [[ -z "${JENKINS_API_TOKEN:-}" && -z "${JENKINS_PASSWORD:-}" ]]; then
  if [[ -f "${JENKINS_HOME:-$HOME/.jenkins}/naukri-secrets.properties" ]]; then
    # shellcheck disable=SC1091
    source "${JENKINS_HOME:-$HOME/.jenkins}/naukri-secrets.properties"
    JENKINS_PASSWORD="${JENKINS_PASSWORD:-${NAUKRI_PASSWORD:-}}"
  fi
fi

if [[ -z "${JENKINS_API_TOKEN:-}" && -z "${JENKINS_PASSWORD:-}" ]]; then
  echo "Set JENKINS_API_TOKEN or JENKINS_PASSWORD"
  exit 1
fi

AUTH="${JENKINS_USER}:${JENKINS_API_TOKEN:-${JENKINS_PASSWORD}}"
CRUMB_JSON=$(curl -sf -u "$AUTH" "${JENKINS_URL}/crumbIssuer/api/json")
CRUMB_FIELD=$(echo "$CRUMB_JSON" | sed -n 's/.*"crumbRequestField":"\([^"]*\)".*/\1/p')
CRUMB=$(echo "$CRUMB_JSON" | sed -n 's/.*"crumb":"\([^"]*\)".*/\1/p')

if curl -sf -u "$AUTH" "${JENKINS_URL}/credentials/store/system/domain/_/credential/NAUKRI_STORAGE_STATE/" >/dev/null 2>&1; then
  echo "Deleting existing NAUKRI_STORAGE_STATE..."
  curl -sf -u "$AUTH" -X POST \
    -H "${CRUMB_FIELD}:${CRUMB}" \
    "${JENKINS_URL}/credentials/store/system/domain/_/credential/NAUKRI_STORAGE_STATE/doDelete"
fi

JSON=$(cat <<'EOF'
{
  "": "0",
  "credentials": {
    "scope": "GLOBAL",
    "id": "NAUKRI_STORAGE_STATE",
    "description": "Naukri Playwright storage state (cookies)",
    "file": "naukri-state.json",
    "stapler-class": "org.jenkinsci.plugins.plaincredentials.impl.FileCredentialsImpl",
    "$class": "org.jenkinsci.plugins.plaincredentials.impl.FileCredentialsImpl"
  }
}
EOF
)

curl -sf -u "$AUTH" \
  -H "${CRUMB_FIELD}:${CRUMB}" \
  -F "json=${JSON}" \
  -F "file0=@${STATE_FILE};filename=naukri-state.json" \
  "${JENKINS_URL}/credentials/store/system/domain/_/createCredentials"

echo "Uploaded NAUKRI_STORAGE_STATE from ${STATE_FILE}"
