import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Modo demostración")).toBeVisible();
});

test("switches between fortnight, week, and month calendar views", async ({ page }) => {
  const fortnight = page.getByRole("button", { name: "Quincena" });
  const week = page.getByRole("button", { name: "Semana" });
  const month = page.getByRole("button", { name: "Mes" });

  await expect(fortnight).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("calendar-day")).toHaveCount(14);

  await week.click();
  await expect(week).toHaveAttribute("aria-pressed", "true");
  await expect(fortnight).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("calendar-day")).toHaveCount(7);

  await month.click();
  await expect(month).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("calendar-day")).toHaveCount(42);
});

test("creates an event, prepares only timely reminders, and saves approval as a style example", async ({ page }) => {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const eventDate = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 8));
  const dateValue = eventDate.toISOString().slice(0, 10);

  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("TÍTULO").fill("Playwright Happy Path Event");
  await page.getByLabel("FECHA").fill(dateValue);
  await page.getByLabel("HORA").fill("19:30");
  await page.getByLabel("LUGAR").fill("Barcelona");
  await page.getByLabel("DESCRIPCIÓN").fill("A friendly evening to meet the community and share ideas.");
  await page.getByRole("button", { name: "Crear evento" }).click();

  await expect(page.getByRole("heading", { name: "Playwright Happy Path Event" })).toBeVisible();
  await expect(page.getByText("14 publicaciones previstas")).toBeVisible();

  await page.getByRole("button", { name: "Calendario" }).click();
  const eventPost = page.getByRole("button", { name: /Playwright Happy Path Event/ }).first();
  await eventPost.click();
  await expect(page.getByRole("heading", { name: "Playwright Happy Path Event" }).last()).toBeVisible();
  await page.getByRole("button", { name: "✓ Aprobar y guardar ejemplo" }).click();

  await page.getByRole("button", { name: "Cuentas" }).click();
  await expect(page.getByText("1 ejemplos aprobados").first()).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Cuentas" }).click();
  await expect(page.getByText("1 ejemplos aprobados").first()).toBeVisible();
});
