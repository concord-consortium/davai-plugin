# AI Assistant Settings

This is a repository of AI assistant settings values for which we want simple version control. The settings values are currently entered and saved at platform.openai.com.

## Directory Structure

Each assistant in the DAVAI project has its own subdirectory containing text files for the specific settings we track. The assistant's Instructions setting value is saved to instructions.txt. Each of the asistant's defined Functions are saved to individual text files in the assistant's `functions` subdirectory.

## Workflow

Since non-developers can modify settings but are unlikely to update this repository, developers should follow these steps to ensure the repository stays reasonably up-to-date:

1. Before making changes, copy the value(s) from platform.openai.com and commit any changes not already recorded here. (The sync-settings.mts script can be used to automatically copy the values from platform.openai.com via the OpenAI API.)
2. Make your changes on platform.openai.com, then update the corresponding files here and commit the changes.

## Scripts

sync-settings.mts in the `scripts` directory can be used to automatically update the assistant settings files with values from platform.openai.com via the OpenAI API.

### Usage:
`node --loader ts-node/esm sync-settings.mts`
