context("Test the overall app", () => {
  it("renders without crashing", () => {
    cy.visit("/");
    cy.get("body").should("contain", "DAVAI");
    cy.get("[data-testid=chat-transcript]").should("exist");
    cy.get("[data-testid=chat-input]").should("exist");
  });
});
