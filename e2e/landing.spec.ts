import { expect, test } from "@playwright/test";

test("the public landing shows access at the top right and opens the workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tus eventos merecen ser compartidos." })).toBeVisible();
  const access = page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Acceder" });
  await expect(access).toBeVisible();
  await expect(access).toHaveAttribute("href", "/workspace");
  const box = await access.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThan(1000);
  expect(box!.y).toBeLessThan(90);
  await access.click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("Modo demostración")).toBeVisible();
});

test("the landing remains usable on a narrow mobile screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const access = page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Acceder" });
  await expect(access).toBeVisible();
  const box = await access.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("link", { name: "Descubre cómo funciona" }).click();
  await expect(page.getByRole("heading", { name: "Una buena reunión empieza mucho antes." })).toBeInViewport();
});

for (const width of [768, 1024]) {
  test(`the landing fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Acceder" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
