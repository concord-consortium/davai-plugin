#!/usr/bin/env bash
# Deploy/update the DAVAI AgentCore STAGING stack in the QA account.
# Mirrors the sam-server pattern (CLI-managed stack); provider keys are read
# from backend/.env so they never appear on the command line or in the shell
# history. Usage:
#   ./deploy-staging.sh [image-uri]
# Requires: AWS CLI profile "agentcore" (QA account 816253370536).
set -euo pipefail
cd "$(dirname "$0")"

PROFILE="${AWS_PROFILE:-agentcore}"
REGION=us-east-1
STACK=davai-agentcore-staging
IMAGE_URI="${1:-816253370536.dkr.ecr.us-east-1.amazonaws.com/davai-agentcore-backend:sse-20260714}"

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
