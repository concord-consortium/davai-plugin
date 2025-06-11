import serverlessExpress from "@vendia/serverless-express";
import app from "./index.ts";

export const handler = serverlessExpress({ app });