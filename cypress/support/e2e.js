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
// out after iframe-phone's 2s limit. That surfaces two expected, app-level errors that
// are unrelated to whether the app renders:
//   1. a rejected promise whose reason is the string "...CODAP request timed out...",
//   2. a TypeError "Cannot read properties of undefined (reading 'success')" thrown when
//      selectSelf's callback receives the undefined timeout result.
// For (1) the rejection reason is a string, so err.stack is Cypress's runner stack, not
// codap-plugin-api — match on the message as well as the stack. Errors from our own code
// still fail the test.
Cypress.on("uncaught:exception", (err) => {
  const text = `${err?.message || ""}\n${err?.stack || ""}`;
  const fromCodapNoHost =
    text.includes("CODAP request timed out") ||
    text.includes("Cannot read properties of undefined (reading 'success')") ||
    text.includes("codap-plugin-api") ||
    text.includes("iframe-phone");
  // Returning false tells Cypress to ignore the error; anything else lets it fail.
  return !fromCodapNoHost;
});
