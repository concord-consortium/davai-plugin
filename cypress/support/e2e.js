// ***********************************************************
// This example support/index.js is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
// import "./commands";

// Alternatively you can use CommonJS syntax:
// require('./commands')

// add code coverage support
import "@cypress/code-coverage/support";

// The plugin talks to CODAP through the CODAP plugin API (iframe-phone). These specs
// load the plugin standalone, with no CODAP host, so codap-plugin-api requests time
// out and call back with `undefined` — and the library then throws asynchronously
// (e.g. selectSelf reading `result.success`). Those library-level errors are expected
// here and unrelated to whether the app renders, so don't let them fail the spec.
// Errors originating in our own code still fail the test.
Cypress.on("uncaught:exception", (err) => {
  const fromCodapComms = err.stack?.includes("codap-plugin-api") || err.stack?.includes("iframe-phone");
  // Returning false tells Cypress to ignore the error; anything else lets it fail.
  return !fromCodapComms;
});
