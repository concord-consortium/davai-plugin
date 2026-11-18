#!/usr/bin/env bash
# Deploy a backend image to a DAVAI AgentCore stack, creating the stack the first
# time. Usage:
#   ./deploy.sh <staging|production> <image-uri>
#
#   staging     davai-agentcore-staging in the QA account (AWS profile "agentcore")
#   production  davai-agentcore-production in the main account (default AWS profile)
#
# Set AWS_PROFILE to use a different profile. The image must already be pushed to
# that account's davai-agentcore-backend repo with a tag that hasn't been deployed
# before (see README.md).
#
# Each deploy creates a new runtime version, which the runtime's DEFAULT endpoint
# serves right away. The script ends by printing ./status.sh, which shows the new
# version number. On production, the `production` endpoint stays where it is
# until ./promote.sh moves it.
#
# The provider keys stay in Secrets Manager: the stack only gets the ARNs of the
# davai-agentcore/{openai,anthropic,google}-api-key secrets in that account.
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -ne 2 ]; then
  echo "Usage: $0 <staging|production> <image-uri>" >&2
  exit 1
fi

ENVIRONMENT="$1"
IMAGE_URI="$2"
case "$ENVIRONMENT" in
  staging) PROFILE="${AWS_PROFILE:-agentcore}" ;;
  production) PROFILE="${AWS_PROFILE:-default}" ;;
  *) echo "Unknown environment: $ENVIRONMENT (expected staging or production)" >&2; exit 1 ;;
esac
REGION=us-east-1
STACK="davai-agentcore-$ENVIRONMENT"
AWS=(aws --profile "$PROFILE" --region "$REGION")

secret_arn() {
  "${AWS[@]}" secretsmanager describe-secret --secret-id "davai-agentcore/$1" --query ARN --output text
}
# Assignments, so a missing secret stops the script (set -e).
OPENAI_ARN="$(secret_arn openai-api-key)"
ANTHROPIC_ARN="$(secret_arn anthropic-api-key)"
GOOGLE_ARN="$(secret_arn google-api-key)"

"${AWS[@]}" cloudformation deploy \
  --stack-name "$STACK" \
  --template-file cloudformation.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "EnvironmentName=$ENVIRONMENT" \
    "ImageUri=$IMAGE_URI" \
    "OpenAIApiKeySecretArn=$OPENAI_ARN" \
    "AnthropicApiKeySecretArn=$ANTHROPIC_ARN" \
    "GoogleApiKeySecretArn=$GOOGLE_ARN"

./status.sh "$ENVIRONMENT"
