#!/usr/bin/env bash
# Install pipeline job definitions into local JENKINS_HOME (no API needed).
set -euo pipefail

JENKINS_HOME="${JENKINS_HOME:-$HOME/.jenkins}"
REPO_URL="${REPO_URL:-https://github.com/ajayhrz/naukri-auto-apply.git}"

install_job() {
  local name="$1"
  local script_path="$2"
  local description="$3"
  local dir="${JENKINS_HOME}/jobs/${name}"

  mkdir -p "$dir"
  cat > "${dir}/config.xml" <<EOF
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
          <name>*/main</name>
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
  echo "Installed: ${name} (${script_path})"
}

install_job "naukri-auto-apply" "Jenkinsfile.index" "Naukri auto-apply — index_runner.js"
install_job "naukri-linkedin-connection" "Jenkinsfile.linkedin_connection" "LinkedIn connections — linkedin_connection_runner.js"
install_job "naukri-linkedin-automation" "Jenkinsfile.linkedin_automation" "LinkedIn automation — linkedin_auto_updater.js"

echo "Reload Jenkins configuration: ${JENKINS_URL:-http://127.0.0.1:8080}/reload-configuration"
