#!/usr/bin/env bash
# Show what a DAVAI AgentCore stack is running: each endpoint, the runtime version
# it serves, and that version's image. Also prints the stack outputs the client
# needs (src/utils/agentcore-config.ts). Usage:
#   ./status.sh <staging|production>
#
# Uses the same AWS profiles as deploy.sh; set AWS_PROFILE to override.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <staging|production>" >&2
  exit 1
fi

ENVIRONMENT="$1"
case "$ENVIRONMENT" in
  staging) PROFILE="${AWS_PROFILE:-agentcore}" ;;
  production) PROFILE="${AWS_PROFILE:-default}" ;;
  *) echo "Unknown environment: $ENVIRONMENT (expected staging or production)" >&2; exit 1 ;;
esac
STACK="davai-agentcore-$ENVIRONMENT"
AWS=(aws --profile "$PROFILE" --region us-east-1)

output() {
  "${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

RUNTIME_ID="$(output AgentRuntimeId)"
echo "$STACK"
echo "  runtime ARN      $(output AgentRuntimeArn)"
echo "  identity pool    $(output IdentityPoolId)"
echo "  unauth role ARN  $(output UnauthenticatedRoleArn)"
echo "  endpoints:"

"${AWS[@]}" bedrock-agentcore-control list-agent-runtime-endpoints --agent-runtime-id "$RUNTIME_ID" \
  --query 'runtimeEndpoints[].[name,liveVersion,status]' --output text |
while read -r NAME VERSION STATUS; do
  read -r IMAGE UPDATED < <("${AWS[@]}" bedrock-agentcore-control get-agent-runtime \
    --agent-runtime-id "$RUNTIME_ID" --agent-runtime-version "$VERSION" \
    --query '[agentRuntimeArtifact.containerConfiguration.containerUri,lastUpdatedAt]' --output text </dev/null)
  printf '    %-11s v%-4s %-8s %s (version created %s)\n' "$NAME" "$VERSION" "$STATUS" "${IMAGE##*/}" "${UPDATED%%.*}"
done
