context("Test the overall app", () => {
  it("renders without crashing", () => {
    cy.visit("/");
    cy.get("body").should("contain", "DAVAI");
    cy.get("[data-testid=chat-transcript]").should("exist");
    cy.get("[data-testid=chat-input]").should("exist");
    // With no CODAP host, the plugin's CODAP API requests (fired on mount) time out after
    // iframe-phone's hard-coded 2s and throw. That throw is ignored by the
    // uncaught:exception handler in support/e2e.js, but only when it fires during the test;
    // if it lands in an after-all hook (which happens on slower builds) Cypress fails the
    // spec regardless. Wait past the 2s timeout so the throw is absorbed here, in the test.
    cy.wait(3000);
  });
});
