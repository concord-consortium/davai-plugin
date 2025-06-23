import serverlessExpress from "@vendia/serverless-express";
import app from "./dist/index.js";

export const handler = serverlessExpress({ app });