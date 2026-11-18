# Sourced by deploy.sh, promote.sh and status.sh, after they set ENVIRONMENT to
# staging or production. Sets ACCOUNT, PROFILE, STACK and AWS (the aws command with
# profile and region), and stops unless the profile's credentials are for the
# environment's account.
#
# The profile defaults to "agentcore" for staging and "default" for production;
# set AWS_PROFILE to use another one.

case "$ENVIRONMENT" in
  staging)
    ACCOUNT=816253370536 # QA account
    PROFILE="${AWS_PROFILE:-agentcore}"
    ;;
  production)
    ACCOUNT=612297603577 # main account
    PROFILE="${AWS_PROFILE:-default}"
    ;;
  *)
    echo "Unknown environment: $ENVIRONMENT (expected staging or production)" >&2
    exit 1
    ;;
esac
STACK="davai-agentcore-$ENVIRONMENT"
AWS=(aws --profile "$PROFILE" --region us-east-1)

if ! CALLER_ACCOUNT="$("${AWS[@]}" sts get-caller-identity --query Account --output text)"; then
  echo "No working credentials for AWS profile \"$PROFILE\". Log in, or set AWS_PROFILE to a" >&2
  echo "profile for account $ACCOUNT (the $ENVIRONMENT stack's account)." >&2
  exit 1
fi
if [ "$CALLER_ACCOUNT" != "$ACCOUNT" ]; then
  echo "AWS profile \"$PROFILE\" is for account $CALLER_ACCOUNT, but the $ENVIRONMENT stack is in" >&2
  echo "account $ACCOUNT. Set AWS_PROFILE to a profile for account $ACCOUNT." >&2
  exit 1
fi
