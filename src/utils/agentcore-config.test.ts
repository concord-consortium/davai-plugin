import { getAgentCoreConfig } from "./agentcore-config";

describe("getAgentCoreConfig", () => {
  const original = process.env.DEPLOY_PATH;
  afterEach(() => {
    if (original === undefined) delete process.env.DEPLOY_PATH;
    else process.env.DEPLOY_PATH = original;
  });

  it("sends release builds to the production stack's production endpoint", () => {
    process.env.DEPLOY_PATH = "version/v1.2.3/";
    const config = getAgentCoreConfig();
    expect(config.runtimeArn).toContain(":612297603577:runtime/davai_agentcore_production-");
    expect(config.unauthRoleArn).toBe("arn:aws:iam::612297603577:role/davai-agentcore-production-unauth");
    expect(config.qualifier).toBe("production");
  });

  it("sends main's build to the production stack's DEFAULT endpoint", () => {
    process.env.DEPLOY_PATH = "branch/main/";
    const config = getAgentCoreConfig();
    expect(config.runtimeArn).toContain(":612297603577:runtime/davai_agentcore_production-");
    expect(config.qualifier).toBeUndefined();
  });

  it.each(["branch/my-feature/", "branch/main-fix/", ""])(
    "sends the build with DEPLOY_PATH %p to the staging stack's DEFAULT endpoint", (deployPath) => {
      process.env.DEPLOY_PATH = deployPath;
      const config = getAgentCoreConfig();
      expect(config.runtimeArn).toContain(":816253370536:runtime/davai_agentcore_staging-");
      expect(config.qualifier).toBeUndefined();
    });
});
