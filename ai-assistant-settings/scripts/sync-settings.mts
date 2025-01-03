#!/usr/bin/env ts-node

/**
 * Updates the local settings files with values from the AI Assistants' settings at platform.openai.com.
 * 
 * Usage:
 *   node --loader ts-node/esm sync-settings.mts
 * 
 * TODO: Make it so `--loader ts-node/esm` isn't required for this to run since Custom ESM Loaders is an
 * experimental feature and could change.
 */

import { OpenAI } from "openai";
import fs from "fs";
import process from "node:process";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const requiredEnvVars = ["REACT_APP_OPENAI_API_KEY", "REACT_APP_OPENAI_BASE_URL"];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  console.error("Missing required environment variables:");
  missingEnvVars.forEach((key) => console.error(`- ${key}`));
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY || "fake-key",
  baseURL: process.env.REACT_APP_OPENAI_BASE_URL,
  organization: "org-jbU1egKECzYlQI73HMMi7EOZ",
  project: "proj_VsykADfoZHvqcOJUHyVAYoDG",
});

const getAssistants = async () => {
  try {
    const { data } = await openai.beta.assistants.list();
    return data;
  } catch (err) {
    console.error("Error fetching assistants:", err);
    return [];
  }
};

const writeAssistantFiles = (assistant: any) => {
  const assistantDir = path.resolve("../assistants", assistant.id);

  fs.mkdirSync(assistantDir, { recursive: true });
  fs.writeFileSync(path.join(assistantDir, "instructions.txt"), assistant.instructions);

  const functionsDir = path.join(assistantDir, "functions");
  fs.mkdirSync(functionsDir, { recursive: true });
  assistant.tools
    .filter((tool: any) => tool.type === "function")
    .forEach((func: any) => {
      const filePath = path.join(functionsDir, `${func.function.name}.txt`);
      fs.writeFileSync(filePath, JSON.stringify(func.function, null, 2));
    });
};

const syncSettings = async () => {
  const assistants = await getAssistants();
  const assistantsDir = path.resolve("../assistants");

  fs.rmSync(assistantsDir, { recursive: true, force: true });
  fs.mkdirSync(assistantsDir);

  assistants.forEach(writeAssistantFiles);
};

syncSettings().catch((err) => {
  console.error("Error during sync:", err);
  process.exit(1);
});
