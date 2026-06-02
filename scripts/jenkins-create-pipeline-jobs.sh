#!/usr/bin/env bash
# Create Jenkins pipeline jobs for index + LinkedIn scripts.
# Usage: JENKINS_URL=http://127.0.0.1:8080 JENKINS_USER=ajay JENKINS_PASSWORD=... ./scripts/jenkins-create-pipeline-jobs.sh
set -euo pipefail

JENKINS_URL="${JENKINS_URL:-http://127.0.0.1:8080}"
JENKINS_USER="${JENKINS_USER:-ajay}"
REPO_URL="${REPO_URL:-https://github.com/ajayhrz/naukri-auto-apply.git}"
BRANCH="${BRANCH:-*/main}"

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

create_job() {
  local job_name="$1"
  local script_path="$2"
  local description="$3"

  if curl -sf -u "$AUTH" "${JENKINS_URL}/job/${job_name}/config.xml" >/dev/null 2>&1; then
    echo "Exists: ${job_name} (update Script Path in UI if needed: ${script_path})"
    return 0
  fi

  local config
  config=$(cat <<EOF
<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>${description}</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs>
        <hudson.plugins.git.UserRemoteConfig>
          <url>${REPO_URL}</url>
        </hudson.plugins.git.UserRemoteConfig>
      </userRemoteConfigs>
      <branches>
        <hudson.plugins.git.BranchSpec>
          <name>${BRANCH}</name>
        </hudson.plugins.git.BranchSpec>
      </branches>
      <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations>
      <submoduleCfg class="empty-list"/>
      <extensions/>
    </scm>
    <scriptPath>${script_path}</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>
EOF
)

  curl -sf -u "$AUTH" \
    -H "${CRUMB_FIELD}:${CRUMB}" \
    -H "Content-Type: application/xml" \
    --data-binary "$config" \
    "${JENKINS_URL}/createItem?name=${job_name}"

  echo "Created: ${job_name} -> ${script_path}"
}

create_job "naukri-auto-apply" "Jenkinsfile.index" "Naukri job auto-apply (index.js via index_runner.js)"
create_job "naukri-linkedin-connection" "Jenkinsfile.linkedin_connection" "LinkedIn connection requests (linkedin_connection.js)"
create_job "naukri-linkedin-automation" "Jenkinsfile.linkedin_automation" "LinkedIn post comments (linkedin_automation.js)"

echo ""
echo "Open Jenkins: ${JENKINS_URL}"
echo "  - ${JENKINS_URL}/job/naukri-auto-apply/"
echo "  - ${JENKINS_URL}/job/naukri-linkedin-connection/"
echo "  - ${JENKINS_URL}/job/naukri-linkedin-automation/"
