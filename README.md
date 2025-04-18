# Data Analysis through Voice and Artificial Intelligence

## Development

### Initial steps

1. Clone this repo and `cd` into it
2. Run `npm install` to pull dependencies
3. Run `npm start` to run `webpack-dev-server` in development mode with hot module replacement

## Testing the plugin in CODAP

Currently there is no trivial way to load a plugin running on a local server with `http` into the online CODAP, which forces `https`. One simple solution is to download the latest `build_[...].zip` file from https://codap.concord.org/releases/zips/, extract it to a folder and run it locally. If CODAP is running on port 8080, and this project is running by default on 8081, you can go to

http://127.0.0.1:8080/static/dg/en/cert/index.html?di=http://localhost:8081

to see the plugin running in CODAP.

# Create React App Readme

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.<br>
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br>
You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.<br>
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.<br>
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

If you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (Webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

You don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

## Configuration Settings

Configuration settings control various aspects of the application's behavior and appearance. Access to the configuration settings is provided by `AppConfigContext` via the `useAppConfigContext` hook.

Default configuration setting values are defined in the `app-config.json` file. Currently, only the `mode` setting can be overridden by URL parameter (e.g. `?mode=development`). Support for overriding some of the other settings with URL parameters may be added in the future. 

### Accessibility

- **`accessibility`** (Object)  
  Settings related to accessibility in the UI:
  - **`keyboardShortcut`** (string): Custom keystroke for placing focus in the main text input field (e.g., `ctrl+?`).

### AssistantId

- **`assistantId`** (string)  
  The unique ID of an existing assistant to use, or "mock" for a mocked assistant.

### Dimensions

- **`dimensions`** (Object)  
  Dimensions of the application's component within CODAP:
  - **`width`** (number): The width of the application (in pixels).
  - **`height`** (number): The height of the application (in pixels).

### Mock Assistant

- **`mockAssistant`** (boolean)  
  A flag indicating whether to mock AI interactions.

### Mode

- **`mode`** (string)  
  The mode in which the application runs. Possible values:
  - `"development"`: Enables additional UI for debugging and artifact maintenance.
  - `"production"`: Standard runtime mode for end users.
  - `"test"`: Specialized mode for automated testing.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).
