#!/usr/bin/env bash
# Point the production stack's `production` endpoint at a runtime version, which
# releases of the plugin then use. Usage:
#   ./promote.sh <runtime-version>
#
# Promote the version that was tested on the DEFAULT endpoint (`./status.sh
# production` shows it). To roll back, promote the previous version again.
#
# Only the endpoint changes: the stack keeps its current template and parameters,
# so nothing else is redeployed. Uses the default AWS profile, or AWS_PROFILE.
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -ne 1 ] || ! [[ "$1" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 <runtime-version>" >&2
  exit 1
fi

VERSION="$1"
STACK=davai-agentcore-production
AWS=(aws --profile "${AWS_PROFILE:-default}" --region us-east-1)

"${AWS[@]}" cloudformation update-stack \
  --stack-name "$STACK" \
  --use-previous-template \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=EnvironmentName,UsePreviousValue=true \
    ParameterKey=ImageUri,UsePreviousValue=true \
    ParameterKey=OpenAIApiKeySecretArn,UsePreviousValue=true \
    ParameterKey=AnthropicApiKeySecretArn,UsePreviousValue=true \
    ParameterKey=GoogleApiKeySecretArn,UsePreviousValue=true \
    "ParameterKey=ProductionVersion,ParameterValue=$VERSION" \
  --query StackId --output text

echo "Waiting for $STACK to finish updating..."
"${AWS[@]}" cloudformation wait stack-update-complete --stack-name "$STACK"

./status.sh production
