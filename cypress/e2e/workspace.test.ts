context("Test the overall app", () => {
  it("renders without crashing", () => {
    cy.visit("/");
    cy.get("body").should("contain", "Loading...");
  });
});
