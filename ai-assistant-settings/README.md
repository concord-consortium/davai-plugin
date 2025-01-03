# AI Assistant Settings

This is a repository of AI assistant settings values for which we want simple version control. The settings values are currently entered and saved at platform.openai.com.

## Directory Structure

Each assistant in the DAVAI project has its own subdirectory containing:

- `instructions.txt`: Stores the assistant's Instructions setting value.
- `functions/`: Contains individual text files for each defined function.

## Workflow

Since non-developers can modify settings but are unlikely to update this repository, developers should follow these steps to ensure the repository stays reasonably up-to-date:

1. **Before making changes, sync existing values.** Use the `sync:assistant-settings` npm script to fetch the latest settings from platform.openai.com, then commit any changes.
2. **Update settings.** Make changes on platform.openai.com, then update the corresponding files here and commit.

## Scripts

The `sync:assistant-settings` npm script uses `sync-settings.mts` in the `scripts` directory to fetch and update assistant settings automatically via the OpenAI API.

### Usage:
`npm run sync:assistant-settings`