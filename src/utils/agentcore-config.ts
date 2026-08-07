// Per-environment AgentCore stack coordinates (from the davai-agentcore-* CloudFormation
// stacks — see infra/cloudformation.yml and infra/DEPLOYED.md). These are PUBLIC values:
// the identity pool intentionally grants unauthenticated access scoped to invoking this
// one runtime, so baking them into the client bundle is the designed access model.

export interface AgentCoreConfig {
  region: string;
  identityPoolId: string;
  // Role assumed via the Cognito CLASSIC flow (GetOpenIdToken + AssumeRoleWithWebIdentity).
  // The enhanced flow's fixed service allowlist excludes bedrock-agentcore.
  unauthRoleArn: string;
  runtimeArn: string;
}

const STAGING: AgentCoreConfig = {
  region: "us-east-1",
  identityPoolId: "us-east-1:f9ef35df-041f-4731-813f-67e998dbc98f",
  unauthRoleArn: "arn:aws:iam::816253370536:role/davai-agentcore-staging-unauth",
  runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore_staging-guJgof856F",
};

// The production stack does not exist yet; released builds intentionally fall back to
// staging until it does (matching the current SAM-server situation, where branch and
// release builds share a server). Replace with the production stack's outputs when created.
const PRODUCTION: AgentCoreConfig = STAGING;

// Branch builds (and local dev) -> staging; released versions (DEPLOY_PATH "version/vX.Y.Z/")
// -> production. Mirrors how the release pipeline distinguishes builds today.
export function getAgentCoreConfig(): AgentCoreConfig {
  const deployPath = process.env.DEPLOY_PATH || "";
  return deployPath.startsWith("version/") ? PRODUCTION : STAGING;
}
