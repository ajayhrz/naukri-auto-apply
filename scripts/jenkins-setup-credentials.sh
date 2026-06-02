#!/usr/bin/env bash
# Create global Jenkins secret-text credentials for auto_updater.
# Usage:
#   export JENKINS_URL=http://127.0.0.1:8080
#   export JENKINS_USER=ajay
#   export JENKINS_API_TOKEN=your-token   # or JENKINS_PASSWORD
#   ./scripts/jenkins-setup-credentials.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JENKINS_URL="${JENKINS_URL:-http://127.0.0.1:8080}"
JENKINS_USER="${JENKINS_USER:-ajay}"

if [[ -z "${JENKINS_API_TOKEN:-}" && -z "${JENKINS_PASSWORD:-}" ]]; then
  echo "Set JENKINS_API_TOKEN or JENKINS_PASSWORD for user ${JENKINS_USER}"
  exit 1
fi

AUTH="${JENKINS_USER}:${JENKINS_API_TOKEN:-${JENKINS_PASSWORD}}"

if [[ ! -f "${ROOT}/.env" ]]; then
  echo "Missing ${ROOT}/.env (NAUKRI_EMAIL, NAUKRI_PASSWORD, EMAIL_APP_PASSWORD)"
  exit 1
fi

# shellcheck disable=SC1091
source "${ROOT}/.env"

for key in NAUKRI_EMAIL NAUKRI_PASSWORD EMAIL_APP_PASSWORD; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing ${key} in .env"
    exit 1
  fi
done

CRUMB_JSON=$(curl -sf -u "$AUTH" "${JENKINS_URL}/crumbIssuer/api/json")
CRUMB_FIELD=$(echo "$CRUMB_JSON" | sed -n 's/.*"crumbRequestField":"\([^"]*\)".*/\1/p')
CRUMB=$(echo "$CRUMB_JSON" | sed -n 's/.*"crumb":"\([^"]*\)".*/\1/p')

create_cred() {
  local id="$1"
  local desc="$2"
  local secret="$3"

  if curl -sf -u "$AUTH" "${JENKINS_URL}/credentials/store/system/domain/_/credential/${id}/" >/dev/null 2>&1; then
    echo "Exists: ${id}"
    return 0
  fi

  local json
  json=$(cat <<EOF
{
  "": "0",
  "credentials": {
    "scope": "GLOBAL",
    "id": "${id}",
    "description": "${desc}",
    "secret": "${secret}",
    "stapler-class": "org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl",
    "\$class": "org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl"
  }
}
EOF
)

  curl -sf -u "$AUTH" \
    -H "${CRUMB_FIELD}:${CRUMB}" \
    --data-urlencode "json=${json}" \
    "${JENKINS_URL}/credentials/store/system/domain/_/createCredentials"
  echo "Created: ${id}"
}

create_cred "NAUKRI_EMAIL" "Naukri login email" "$NAUKRI_EMAIL"
create_cred "NAUKRI_PASSWORD" "Naukri login password" "$NAUKRI_PASSWORD"
create_cred "EMAIL_APP_PASSWORD" "Gmail app password for updater emails" "$EMAIL_APP_PASSWORD"

echo "Done. Verify at ${JENKINS_URL}/manage/credentials/store/system/domain/_/"
echo ""
echo "Optional (recommended for Jenkins): save a Naukri login session locally:"
echo "  cd ${ROOT} && npm run save-session"
echo "Then in Jenkins → Credentials → Add → Secret file, ID: NAUKRI_STORAGE_STATE"
echo "  Upload: ${ROOT}/.auth/naukri-state.json"
echo "Bind it in the job (if you extend the pipeline) or copy to the agent workspace .auth/"
