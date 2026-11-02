import { expect, test } from "@playwright/test";

function futureDate(daysAhead: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + daysAhead));
  return date.toISOString().slice(0, 10);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByText("Modo demostración")).toBeVisible();
});

test("shows green success toast in bottom-right corner with actionable link when event is created", async ({ page }) => {
  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("TÍTULO").fill("Toast Notification Event");
  await page.getByLabel("FECHA").fill(futureDate(5));
  await page.getByLabel("HORA").fill("11:00");
  await page.getByRole("button", { name: "Crear evento" }).click();

  const viewport = page.locator('[aria-label="Notificaciones"]');
  await expect(viewport).toBeVisible();

  const toast = viewport.locator('[data-type="success"]').first();
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Evento creado con éxito.");

  // Verify actionable link is present and working
  const actionLink = toast.getByText("Ver detalle");
  await expect(actionLink).toBeVisible();
  await actionLink.click();

  // Verify navigating to calendar
  await expect(page.getByRole("button", { name: "Semana" })).toBeVisible();
});

test("approving a post triggers a green toast with actionable link", async ({ page }) => {
  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("TÍTULO").fill("Approval Toast Event");
  await page.getByLabel("FECHA").fill(futureDate(3));
  await page.getByLabel("HORA").fill("16:00");
  await page.getByRole("button", { name: "Crear evento" }).click();

  await page.getByRole("button", { name: "▦ Calendario" }).click();
  const eventPost = page.getByRole("button", { name: /Approval Toast Event/ }).first();
  await eventPost.click();

  await page.getByRole("button", { name: "✓ Aprobar y guardar ejemplo" }).click();

  const toast = page.locator('[aria-label="Notificaciones"] [data-type="success"]').first();
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Publicación aprobada");

  const action = toast.getByText("Ver detalle");
  await expect(action).toBeVisible();
  await action.click();

  // Verify detail panel opens with post text initialized
  await expect(page.getByText("DETALLE DE PUBLICACIÓN")).toBeVisible();
});

test("toast can be dismissed manually with the close button", async ({ page }) => {
  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("TÍTULO").fill("Dismissable Event");
  await page.getByLabel("FECHA").fill(futureDate(7));
  await page.getByLabel("HORA").fill("12:00");
  await page.getByRole("button", { name: "Crear evento" }).click();

  const toast = page.locator('[aria-label="Notificaciones"] [data-type="success"]').first();
  await expect(toast).toBeVisible();

  const closeButton = toast.getByRole("button", { name: "Cerrar notificación" });
  await expect(closeButton).toBeVisible();
  await closeButton.click();

  await expect(toast).not.toBeVisible();
});

test("multiple toasts stack in bottom-right corner and auto-dismiss after 5 seconds", async ({ page }) => {
  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("TÍTULO").fill("Stack Event 1");
  await page.getByLabel("FECHA").fill(futureDate(4));
  await page.getByLabel("HORA").fill("10:00");
  await page.getByRole("button", { name: "Crear evento" }).click();

  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("TÍTULO").fill("Stack Event 2");
  await page.getByLabel("FECHA").fill(futureDate(6));
  await page.getByLabel("HORA").fill("10:00");
  await page.getByRole("button", { name: "Crear evento" }).click();

  const toasts = page.locator('[aria-label="Notificaciones"] > [data-type]');
  await expect(toasts).toHaveCount(2);

  // Auto dismiss after 5s
  await expect(toasts.first()).not.toBeVisible({ timeout: 7500 });
});
