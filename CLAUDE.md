# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DAVAI (Data Analysis through Voice and Artificial Intelligence) is a CODAP plugin that helps blind/low-vision users work with graphs and datasets through voice, chat, and audio (sonification). It consists of:
- A React client app in `/src` (the plugin that loads inside CODAP).
- An AWS SAM / Lambda backend in `/sam-server` that brokers all LLM calls.

The client never talks to an LLM provider directly — it posts to the server, which routes to the configured provider (OpenAI, Google/Gemini, or Anthropic) via LangChain/LangGraph.

## Commands

### Client development
```bash
npm start                    # webpack-dev-server on port 8080 (HTTP); proxies CODAP from codap3.concord.org
npm run start:secure         # Same, but HTTPS (uses certs in ~/.localhost-ssl/)
```

### Building
```bash
npm run build                # Production build (runs lint:build + webpack)
npm run build:webpack        # Direct webpack build (no lint)
npm run gen:config-docs      # Regenerate docs/configuration.md from app-config-model.ts
```

### Testing
```bash
npm test                     # Jest unit tests
npm test -- path/to/file.test.ts   # Run a single test file
npm test -- -t "test name"   # Run tests matching a name
npm run test:watch           # Jest in watch mode
npm run test:coverage        # Jest with coverage report
npm run test:cypress         # Cypress E2E tests
npm run test:cypress:open    # Open Cypress UI
npm run test:full            # Unit + E2E
```

### Linting
```bash
npm run lint                 # ESLint check (src + cypress)
npm run lint:fix             # Auto-fix lint issues
npm run lint:build           # Strict lint config used in CI (.eslintrc.build.js)
```

### Server (`/sam-server`)
Has its own `package.json`/`node_modules` — run `npm install` inside `sam-server/` first.
```bash
npm test                     # Server unit tests (run from sam-server/)
npm run sam:build            # Build the SAM application
npm run sam:deploy           # Guided deploy to AWS (prod stack: davai-server)
npm run sam:deploy:staging-a # Deploy to staging-a (also staging-b)
```
The `/sam-server` backend is deployed manually — CI never deploys it. See [docs/deploy.md](docs/deploy.md).

## Architecture

### Client ⇄ server request lifecycle (the core flow)
LLM requests are **asynchronous and polled**, not request/response. Driven from `assistant-model.ts`:
1. Client POSTs to the `message` (or `tool`) endpoint via `postMessage()` in `src/utils/llm-utils.ts`. Server returns a `messageId`.
2. Server (`sam-server/src/handlers/message.ts`) writes a job row to Postgres (`jobs` table) and enqueues `{messageId}` to SQS.
3. `job-processor.ts` (SQS-triggered Lambda) runs the LLM call via LangGraph and writes the result back to the job row.
4. Client polls the `status?messageId=...` endpoint until `status` is `completed` / `cancelled` / it times out.
5. Tool calls (`requires_action`) repeat the same submit-then-poll loop; `cancel.ts` cancels an in-flight job.

`src/utils/llm-utils.ts` is just the HTTP client for these endpoints (plus helpers like base64→image). The actual **LLM provider abstraction lives server-side** in `sam-server/src/utils/llm-utils.ts`: `createModelInstance()` switches on `provider` to build a `ChatOpenAI` / `ChatGoogleGenerativeAI` / Anthropic model, and `getLangApp()` wraps it in a LangGraph app.

### LLM selection (`llmId`)
`llmId` is a JSON **string**, e.g. `{"id":"gpt-4o-mini","provider":"OpenAI"}`. The list of selectable models is `llmList` in `app-config.json` (providers: `OpenAI`, `Google`, `Anthropic`, `Mock`). A `provider`/`id` of `Mock`/`mock` short-circuits everything: `assistant-model.ts` (`isAssistantMocked`) replies locally without hitting the server — useful for offline/dev work.

### State management (MobX State Tree)
- **RootStore** (`src/models/root-store.ts`)
  - `assistantStore` (`AssistantModel`) — LLM threading, message submission/polling, chat transcript, mock handling.
  - `sonificationStore` (`GraphSonificationModel`) — describes how a CODAP graph maps to audio.
  - `transportManager` (volatile, `transport-manager.ts`) — the Tone.js audio **playback transport** (panning, scheduling, play/pause). Volatile = not persisted. *(This is audio, not networking.)*

Other notable models: `chat-transcript-model.ts` (message history), `app-config-model.ts` (config with runtime validation), `bin-model.ts` / `codap-graph-model.ts` (graph data), `graph-sonification-scheduler.ts` (schedules sonification events on the transport).

### Components, contexts, services
- Components in `src/components/` — functional, wrapped in `observer()` for MobX reactivity. Entry is `App.tsx` (CODAP integration); `chat-input.tsx`, `chat-transcript.tsx`, `graph-sonification.tsx`, `user-options.tsx`, `developer-options.tsx` (dev-mode debug tools).
- Contexts: `AppConfigContext` (`useAppConfigContext()`), `AriaLiveContext` (screen-reader announcements — important for the a11y mission), `RootStoreContext`.
- `src/services/speech-service.ts` — text-to-speech via the Web Speech API (`speechSynthesis`).
- CODAP integration helpers: `src/utils/codap-api-utils.ts`; sonification logic: `src/utils/graph-sonification-utils.ts`.

## Configuration

Settings are defined in `app-config.json`, validated by the schema in `app-config-model.ts`, and accessed via `useAppConfigContext()`. Generated docs live in `docs/configuration.md` (regenerate with `npm run gen:config-docs`).

Override any setting via:
- URL parameter: `?mode=development`
- localStorage with a `davai:` prefix: `davai:mode` = `development`

Nested settings: the UI saves only top-level keys, with nested values as JSON — `davai:keyboardShortcuts` = `{"focusChatInput": "value"}`. Manually you can instead use dot notation: `davai:keyboardShortcuts.focusChatInput` = `value`.

## Local development & environments

See [README.md](README.md#environments-and-the-llm-server) and [docs/deploy.md](docs/deploy.md) for the full picture. Load-bearing points:

- **Mock mode** runs the whole client with no server and no API keys: dev mode (`?mode=development`) → pick **Mock LLM**. It returns canned replies and never calls the server. Real LLM behavior requires pointing the client at a deployed server (staging or prod).
- The server URL (`LANGCHAIN_SERVER_URL`) and `AUTH_TOKEN` are **baked in at build time** — no runtime override. Local builds read them from gitignored `.env`; CI builds read them from a single shared GitHub secret.
- **CI deploys only the frontend.** The `/sam-server` backend is deployed **manually** (`npm run sam:deploy`, or `sam:deploy:staging-a` / `:staging-b` for the staging stacks) to three independent stacks. Consequently, deployed `main` and all CI branch previews currently talk to the **production** server.

## Testing the plugin in CODAP

`npm start` serves the plugin on **http://localhost:8080** and proxies everything it doesn't serve to `codap3.concord.org` (`devServer.proxy` in `webpack.config.js`). That makes CODAP and the local plugin **same-origin**, sidestepping CODAP's https/mixed-content restriction:
- CODAP (proxied): `http://localhost:8080/branch/main/`
- The plugin (served by webpack): `http://localhost:8080/`

Load the plugin into CODAP with the `di` (data-interactive) URL param, all on the same origin:

```
http://localhost:8080/branch/main/?di=http%3A%2F%2Flocalhost%3A8080%2F%3Fmode%3Ddevelopment
```

(That `di` value is `http://localhost:8080/?mode=development`, URL-encoded so the nested query string survives.) Use `npm run start:secure` if you need the dev server over HTTPS instead.

## AI assistant settings (`/ai-assistant-settings`)
Version-controlled copies of OpenAI-platform assistant instructions/functions. Sync the latest from platform.openai.com with `npm run sync:assistant-settings` before editing, then commit.

## Key patterns
- Functional components with hooks, wrapped in `observer()`.
- Test files co-located with source (`.test.ts`/`.test.tsx`).
- Volatile MST properties for non-persisted state (e.g. `transportManager`).
- Tone.js is mocked in tests (`src/test-utils/`, `__mocks__/`).
