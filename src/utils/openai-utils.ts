import { OpenAI } from "openai";

export const newOpenAI = () => {
  return new OpenAI({
    apiKey: process.env.REACT_APP_OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
    organization: "org-jbU1egKECzYlQI73HMMi7EOZ",
    project: "proj_VsykADfoZHvqcOJUHyVAYoDG",
  });
};
