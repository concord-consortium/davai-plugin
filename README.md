# Data Analysis through Voice and Artificial Intelligence

The Data Analysis through Voice and Artificial Intelligence (DAVAI) CODAP plugin is an interface between CODAP, the user, and an external LLM that helps the user understand and work with datasets in a CODAP document. Currently, its main focus in on helping blind or low-vision users work with graphs.

## Development

The code consists of a React-based client app (in `/src`) and a Node-based server app (in `/server`).

### Initial steps

1. Clone this repo and `cd` into it
2. Run `npm install` to pull dependencies
3. Run `npm start` to run `webpack-dev-server` in development mode with hot module replacement
4. In a separate terminal, `cd` into the `/server` directory
5. Run `npm install` to pull dependencies
6. Run `npm start` to start the server app

## Testing the plugin in CODAP

Currently there is no trivial way to load a plugin running on a local server with `http` into the online CODAP, which forces `https`.

### Method one
One simple solution is to download the latest `build_[...].zip` file from https://codap.concord.org/releases/zips/, extract it to a folder and run it locally. If CODAP is running on port 8080, and this project is running by default on 8081, you can go to

http://127.0.0.1:8080/static/dg/en/cert/index.html?di=http://localhost:8081

to see the plugin running in CODAP.

### Method two

1. Start the DAVAI plugin by running `npm start` in this codebase.
2. Open the CODAP repository, navigate to the `v3` directory, and run `npm start` to launch CODAP locally.
3. Open a new Chrome window with web security disabled by running:
  ```
  open -na "Google Chrome" --args --disable-web-security --user-data-dir=/tmp
  ```
4. In this Chrome window, go to the local CODAP URL (e.g., `http://localhost:8080`) and open a sample file (such as "Mammals").
5. In CODAP, go to **Options** > **Load web page**, and enter the local DAVAI plugin URL (for example, `http://localhost:8081/?mode=development`).

This method allows you to test the plugin locally in CODAP, bypassing browser security restrictions that normally prevent loading local resources.

## Configuration Settings

Configuration settings control various aspects of the application's behavior and appearance. Access to the configuration settings is provided by `AppConfigContext` via the `useAppConfigContext` hook.

[Documentation for all settings](docs/configuration.md)

Default configuration setting values are defined in the `app-config.json` file, as well as some are defined in `app-config-model.ts` itself.

All settings can be overridden by URL parameter (e.g. `?mode=development`) or local storage with a prefix of `davai:` (e.g. `davai:mode | development`)

Some settings have UI to change them, these changes will be stored in local storage. When the UI saves settings only the top level keys are saved with nested objects in JSON format. So if you set the `keyboardShortcuts.focusChatInput` in the UI it will be saved as `davai:keyboardShortcuts | {"focusChatInput": "value"}`. If you are manually creating local storage values you can use dot notation for this instead: `davai:keyboardShortcuts.focusChatInput | value`. It is undefined what happens if you have both defined with conflicting values.

When the UI saves the settings it will only save values that you have change or that already exist in local storage. So if you change a setting back to its default, it will remain in local storage.

## Learn More

To learn React, check out the [React documentation](https://reactjs.org/).
