#!/usr/bin/env bash
# Deploy/update the DAVAI AgentCore STAGING stack in the QA account.
# Mirrors the sam-server pattern (CLI-managed stack); provider keys are read
# from backend/.env so they stay out of the shell history (they are still
# passed to the aws process as arguments). Usage:
#   ./deploy-staging.sh <image-uri>
# The image URI is required: give the tag you just pushed (see README.md).
# Requires: AWS CLI profile "agentcore" (QA account 816253370536).
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <image-uri>" >&2
  echo "  e.g. 816253370536.dkr.ecr.us-east-1.amazonaws.com/davai-agentcore-backend:<tag>" >&2
  exit 1
fi

PROFILE="${AWS_PROFILE:-agentcore}"
REGION=us-east-1
STACK=davai-agentcore-staging
IMAGE_URI="$1"

env_val() { grep "^${1}=" ../backend/.env | cut -d= -f2- ; }

aws cloudformation deploy \
  --profile "$PROFILE" --region "$REGION" \
  --stack-name "$STACK" \
  --template-file cloudformation.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    EnvironmentName=staging \
    "ImageUri=$IMAGE_URI" \
    "OpenAIApiKey=$(env_val OPENAI_API_KEY)" \
    "AnthropicApiKey=$(env_val ANTHROPIC_API_KEY)" \
    "GoogleApiKey=$(env_val GOOGLE_API_KEY)"

aws cloudformation describe-stacks \
  --profile "$PROFILE" --region "$REGION" --stack-name "$STACK" \
  --query 'Stacks[0].Outputs' --output table
