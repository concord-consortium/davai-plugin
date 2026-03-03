# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DAVAI (Data Analysis through Voice and Artificial Intelligence) is a CODAP plugin that helps blind/low-vision users work with graphs and datasets. It consists of a React client app (`/src`) and a Node server (`/server` or `/sam-server` for AWS Lambda).

## Commands

### Development
```bash
npm start                    # Dev server on port 8081 (HTTP)
npm run start:secure         # Dev server with HTTPS
```

### Building
```bash
npm run build                # Production build (runs lint:build + webpack)
npm run build:webpack        # Direct webpack build
```

### Testing
```bash
npm test                     # Run Jest unit tests
npm run test:watch           # Jest in watch mode
npm run test:coverage        # Jest with coverage report
npm run test:cypress         # Run Cypress E2E tests
npm run test:cypress:open    # Open Cypress UI
npm run test:full            # All tests (unit + E2E)
```

### Linting
```bash
npm run lint                 # ESLint check
npm run lint:fix             # Auto-fix lint issues
npm run lint:build           # Strict lint (used in CI)
```

## Architecture

### State Management (MobX State Tree)
The app uses MobX State Tree for state management with this hierarchy:
- **RootStore** (`src/models/root-store.ts`) - Top-level container
  - `assistantStore` (AssistantModel) - AI assistant state, threading, messages
  - `sonificationStore` (GraphSonificationModel) - Audio graph representation
  - `transportManager` (volatile) - Communication layer, not persisted

Key model files:
- `assistant-model.ts` - LLM interactions, message queue, chat transcript
- `graph-sonification-model.ts` - Tone.js audio synthesis for graphs
- `chat-transcript-model.ts` - Message history
- `app-config-model.ts` - Configuration with runtime validation

### React Components
Main components in `src/components/`:
- `App.tsx` - Root component, CODAP integration
- `chat-input.tsx` - Message input with voice support
- `chat-transcript.tsx` - Message history display
- `graph-sonification.tsx` - Audio controls for graphs
- `user-options.tsx` - Settings UI
- `developer-options.tsx` - Debug tools (dev mode only)

### Context Providers
- `AppConfigContext` - Access config via `useAppConfigContext()`
- `AriaLiveContext` - Screen reader announcements
- `RootStoreContext` - MobX store access

### Utilities
- `src/utils/codap-api-utils.ts` - CODAP Plugin API helpers
- `src/utils/graph-sonification-utils.ts` - Sonification logic
- `src/utils/llm-utils.ts` - LLM provider abstraction (OpenAI, Gemini, mock)

## Configuration

Settings defined in `app-config.json` with schema in `app-config-model.ts`. Override via:
- URL parameter: `?mode=development`
- localStorage: `davai:mode` = `development`

Nested settings use JSON in localStorage: `davai:keyboardShortcuts` = `{"focusChatInput": "value"}`

## Testing in CODAP

Run local CODAP (from codap repo v3 directory) and this plugin, then either:
1. Use local CODAP at `http://127.0.0.1:8080/static/dg/en/cert/index.html?di=http://localhost:8081`
2. Open Chrome with disabled security: `open -na "Google Chrome" --args --disable-web-security --user-data-dir=/tmp`

## Key Patterns

- Functional components with hooks, wrapped in `observer()` for MobX reactivity
- Test files co-located with source (`.test.tsx`)
- Volatile MST properties for non-persisted state
- Tone.js mocked in tests (`src/test-utils/`)
