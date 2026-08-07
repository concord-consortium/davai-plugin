import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("App inside of CODAP", async ({page}) => {
  await page.setViewportSize({width: 1400, height: 800});
  await page.goto("https://codap3.concord.org/?mouseSensor&di=https://localhost:8080");

  const iframe = page.frameLocator(".codap-web-view-iframe");
  await iframe.getByRole("button", { name: "Create some data" }).click();
  await iframe.getByRole("button", { name: "Open Table" }).click();

  // Make sure the table has something from our data in it
  await expect(page.getByTestId("collection-table-grid")).toContainText("dog");

  await iframe.getByRole("button", { name: "See getAllItems response" }).click();
  const responseBox = iframe.getByRole("status", { name: "Response:" });
  await expect(responseBox).toContainText(/"success": true/);
  await expect(responseBox).toContainText(/"animal": "dog"/);

  await page.getByTestId("collection-table-grid").getByText("dog").dblclick();
  await page.getByTestId("cell-text-editor").fill("dogs");
  await page.getByTestId("cell-text-editor").press("Enter");

  const locationBox = iframe.getByRole("status", { name: "Listener Notification:" });
  await expect(locationBox).toContainText(/"success":true/);
  await expect(locationBox).toContainText(/"animal":"dogs"/);
});
