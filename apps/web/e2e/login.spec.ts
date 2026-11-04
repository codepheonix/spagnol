import { expect, test } from "@playwright/test";

test("login page renders and rejects bad credentials", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /sign in|accedi/i })).toBeVisible();
  await page.locator("input[type=email]").fill("nobody@example.com");
  await page.locator("input[type=password]").fill("wrong-password");
  await page.getByRole("button", { name: /sign in|accedi/i }).click();
  await expect(page.locator(".msg.err")).toContainText(/invalid/i);
});

test("unauthenticated API returns 401 and pages redirect", async ({ request, page }) => {
  const res = await request.get("/api/me");
  expect(res.status()).toBe(401);
  await page.goto("/posts");
  await expect(page).toHaveURL(/\/login/);
});
