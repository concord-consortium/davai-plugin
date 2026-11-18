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
  // The runtime endpoint to invoke. Omitted, AgentCore uses DEFAULT, which serves the
  // runtime's newest version.
  qualifier?: string;
}

const STAGING: AgentCoreConfig = {
  region: "us-east-1",
  identityPoolId: "us-east-1:f9ef35df-041f-4731-813f-67e998dbc98f",
  unauthRoleArn: "arn:aws:iam::816253370536:role/davai-agentcore-staging-unauth",
  runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore_staging-guJgof856F",
};

// The production stack (infra/README.md). Its DEFAULT endpoint serves the runtime's
// newest version, where release candidates are tested; its `production` endpoint stays
// on a tested version until that version is promoted.
const PRODUCTION_STACK: AgentCoreConfig = {
  region: "us-east-1",
  identityPoolId: "us-east-1:a5e4cbee-dfc7-4a29-b3d6-c8f52fa07b7e",
  unauthRoleArn: "arn:aws:iam::612297603577:role/davai-agentcore-production-unauth",
  runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:612297603577:runtime/davai_agentcore_production-TFK1Yl3Aea",
};
const RELEASE_CANDIDATE: AgentCoreConfig = PRODUCTION_STACK;
const RELEASE: AgentCoreConfig = { ...PRODUCTION_STACK, qualifier: "production" };

// Picks the stack and endpoint from the build's DEPLOY_PATH:
//   version/vX.Y.Z/  released versions  -> production stack, `production` endpoint
//   branch/main/     main               -> production stack, DEFAULT endpoint
//   anything else    other branches and local dev -> staging stack, DEFAULT endpoint
export function getAgentCoreConfig(): AgentCoreConfig {
  const deployPath = process.env.DEPLOY_PATH || "";
  if (deployPath.startsWith("version/")) return RELEASE;
  if (deployPath === "branch/main/") return RELEASE_CANDIDATE;
  return STAGING;
}
