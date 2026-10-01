import { test, expect } from "@playwright/test";

/**
 * SE Copilot golden path (UI). Requires the web app + worker against a
 * disposable database seeded with INTERNAL_DOMAINS including example.com
 * (so the test user lands in the team). Never touches Zoom, Teams, Graph,
 * Recall or Claude: the meeting is added manually and nothing is sent.
 */
test.describe("golden path", () => {
  test("sign up, add a meeting, take notes, paste a transcript, cancel another meeting", async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;
    const password = "Str0ngTestPassw0rd!";

    await page.goto("/sign-up");
    await page.getByLabel("Name").fill("E2E Test SE");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page.getByText("Today's meetings")).toBeVisible();

    // Add a meeting that already happened, with customer participants.
    await page.getByRole("link", { name: "Add meeting" }).first().click();
    await expect(page).toHaveURL(/\/meetings\/new/);
    const title = `E2E Contoso discovery ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Zoom or Teams link (optional)").fill("https://contoso.zoom.us/j/98765432101");
    await expect(page.getByText("Zoom link — the notetaker can join")).toBeVisible();
    await page.getByLabel("Participants").fill("Jane Doe <jane@contoso-e2e.example>");
    await page.getByRole("button", { name: "Add meeting" }).click();

    await expect(page).toHaveURL(/\/meetings\/[a-f0-9-]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("Contoso E2e", { exact: false })).toBeVisible(); // customer detected from the domain

    // Keyboard-first notes: Alt+1 = Requirement.
    await page.getByRole("tab", { name: /Notes/ }).click();
    const box = page.getByLabel("New note");
    await box.click();
    await page.keyboard.press("Alt+1");
    await box.fill("Delta migration for 2,000 users");
    await box.press("Enter");
    await box.fill("Second note typed immediately after");
    await box.press("Enter");
    await expect(page.getByText("Delta migration for 2,000 users")).toBeVisible();
    await expect(page.getByText("Second note typed immediately after")).toBeVisible();
    await expect(page.getByText("Requirement", { exact: true }).first()).toBeVisible();

    // Fallback capture: paste a transcript.
    await page.getByRole("tab", { name: "Transcript" }).click();
    await page.getByLabel("Transcript text").fill("Jane Doe: We need delta migration.\nSE: That is supported.");
    await page.getByRole("button", { name: "Save transcript & generate MOM" }).click();
    await expect(page.getByText(/Transcript saved \(2 segments\)/)).toBeVisible({ timeout: 10_000 });

    // A second, future meeting can be cancelled.
    await page.goto("/meetings/new");
    const future = `E2E cancel me ${Date.now()}`;
    await page.getByLabel("Title").fill(future);
    await page.getByRole("button", { name: "Add meeting" }).click();
    await expect(page.getByRole("heading", { name: future })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Cancel meeting" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel meeting" }).click();
    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});
