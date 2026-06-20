# Data Analysis through Voice and Artificial Intelligence

The Data Analysis through Voice and Artificial Intelligence (DAVAI) CODAP plugin is an interface between CODAP, the user, and an external LLM that helps the user understand and work with datasets in a CODAP document. Currently, its main focus in on helping blind or low-vision users work with graphs.

## Development

The code consists of a React-based client app (in `/src`) and an AWS SAM / Lambda backend (in `/sam-server`) that brokers all LLM calls. During development you run the **client** locally; the **server** is a deployed AWS stack — you do not run it locally. See [Environments and the LLM server](#environments-and-the-llm-server) below.

### Initial steps

1. Clone this repo and `cd` into it
2. Run `npm install` to pull dependencies
3. Run `npm start` to run `webpack-dev-server` in development mode with hot module replacement
4. Load the plugin into CODAP (see [Testing the plugin in CODAP](#testing-the-plugin-in-codap) below)

To work on the client without any server or API keys, enable development mode (append `?mode=development` to the plugin URL, or set `davai:mode | development` in local storage) and choose **Mock LLM** from the model picker in the Developer Options panel. In mock mode the client returns canned assistant replies and never calls the server — ideal for UI, sonification, voice input, and CODAP-integration work. To exercise a real LLM, point the client at a deployed server (see [Environments and the LLM server](#environments-and-the-llm-server)).

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

## Environments and the LLM server

All LLM calls go through the server in [`/sam-server`](sam-server), an AWS SAM / Lambda app; the client never calls an LLM provider directly. There are three independent, manually-deployed server stacks — **production**, **staging-a**, and **staging-b** — each with its own Lambdas, database, and secrets. See [docs/deploy.md](docs/deploy.md) for how each is deployed.

### How the client picks a server

The client reads two values **at build time** and bakes them into the bundle (via webpack's `EnvironmentPlugin`):

- `LANGCHAIN_SERVER_URL` — the server's base URL
- `AUTH_TOKEN` — must match that server stack's `DAVAI_API_SECRET`

There is **no runtime override**: the server a build talks to is fixed when it is built. The values come from:

- **Local builds** (`npm start` / `npm run build`): your `.env` file (gitignored — copy `.env.example`). Set `LANGCHAIN_SERVER_URL` + `AUTH_TOKEN` to the stack you want (commonly staging-a). Stack names are in [`sam-server/samconfig.toml`](sam-server/samconfig.toml); get the actual endpoint URLs and tokens from the team and **do not commit them**.
- **CI builds**: a single shared `LANGCHAIN_SERVER_URL` GitHub Actions secret, used for every branch.

### Two independent choices when developing

1. **Mock vs. real LLM.** The `Mock` provider (selectable in Developer Options) makes the client return canned replies and never contact the server — fully client-side, no keys. Use it for UI, sonification, voice, and CODAP-integration work.
2. **Which server a real-LLM build talks to.** Set `LANGCHAIN_SERVER_URL` in `.env` to a deployed **staging** stack (staging-a/b) for development and testing, or **prod**. You always run the client locally during development; only the server location changes.

### Which server is each build using?

- The deployed **`main`** build — and, because CI uses one shared secret, **every branch preview** — points at the **production** server.
- A local `npm start` points wherever your `.env` says (commonly **staging-a**).

So a branch preview deployed by CI talks to **production**, not staging. There is currently **no shareable URL** of a branch's frontend that points at a staging server. If you need one, build locally with a staging `.env` (`npm run build`) and host the static `dist/` on any **https** host (CODAP requires https), then load it in CODAP via `di=<that-url>`.

## Configuration Settings

Configuration settings control various aspects of the application's behavior and appearance. Access to the configuration settings is provided by `AppConfigContext` via the `useAppConfigContext` hook.

[Documentation for all settings](docs/configuration.md)

Default configuration setting values are defined in the `app-config.json` file, as well as some are defined in `app-config-model.ts` itself.

All settings can be overridden by URL parameter (e.g. `?mode=development`) or local storage with a prefix of `davai:` (e.g. `davai:mode | development`)

Some settings have UI to change them, these changes will be stored in local storage. When the UI saves settings only the top level keys are saved with nested objects in JSON format. So if you set the `keyboardShortcuts.focusChatInput` in the UI it will be saved as `davai:keyboardShortcuts | {"focusChatInput": "value"}`. If you are manually creating local storage values you can use dot notation for this instead: `davai:keyboardShortcuts.focusChatInput | value`. It is undefined what happens if you have both defined with conflicting values.

When the UI saves the settings it will only save values that you have change or that already exist in local storage. So if you change a setting back to its default, it will remain in local storage.

## Learn More

To learn React, check out the [React documentation](https://reactjs.org/).
