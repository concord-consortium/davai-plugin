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
// codap-plugin-api, and a non-Error reason has no .message — so search String(err) too.
// Only these two no-host cases are ignored (the TypeError must come from the CODAP comms
// layer); real bugs in our code, or elsewhere in those libraries, still fail the test.
Cypress.on("uncaught:exception", (err) => {
  const text = `${err?.message || ""}\n${err?.stack || ""}\n${String(err)}`;
  const fromCodapComms = text.includes("codap-plugin-api") || text.includes("iframe-phone");
  const isNoHostTimeout =
    // (1) the rejected promise whose reason is the timeout string
    text.includes("CODAP request timed out") ||
    // (2) selectSelf reading `success` off the undefined timeout result — only when the
    //     throw actually originates in the CODAP comms layer
    (fromCodapComms && /reading '?success'?/.test(text));
  // Returning false tells Cypress to ignore the error; anything else lets it fail.
  return !isNoHostTimeout;
});
