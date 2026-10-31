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

test("expands a crowded day and opens every account's publication, including an uncertain one", async ({ page }) => {
  // Start without demo fixtures so the seven posts on the reminder day are unambiguous.
  await page.evaluate(() => localStorage.setItem("findly-state-v1", JSON.stringify({ events: [], posts: [], mode: "review" })));
  await page.reload();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const dateFromToday = (days: number) => new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + days)).toISOString().slice(0, 10);
  const reminderDate = dateFromToday(1);

  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("TÍTULO").fill("Seven channel event");
  await page.getByLabel("FECHA").fill(dateFromToday(8));
  await page.getByLabel("HORA").fill("19:30");
  await page.getByRole("button", { name: "Crear evento" }).click();
  await page.getByRole("button", { name: "Calendario" }).click();

  const reminderDay = page.locator(`[data-testid="calendar-day"][data-calendar-date="${reminderDate}"]`);
  const periodHeading = page.getByRole("heading", { level: 2 }).first();
  const period = await periodHeading.textContent();
  expect(period).not.toBeNull();
  const expand = reminderDay.getByRole("button", { name: `Mostrar 4 publicaciones más del ${reminderDate}` });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(reminderDay.getByRole("button", { name: `Mostrar menos publicaciones del ${reminderDate}` })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Quincena" })).toHaveAttribute("aria-pressed", "true");
  await expect(periodHeading).toHaveText(period!);
  await expect(reminderDay.getByRole("button", { name: "Seven channel event · Barcelona JUG · LinkedIn · Pendiente de revisión" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(reminderDay.getByRole("button", { name: "Seven channel event · Barcelona JUG · X · Pendiente de revisión" })).toBeFocused();

  const channels = [
    ["Personal", "LinkedIn"], ["Personal", "X"], ["Personal", "Bluesky"],
    ["Barcelona JUG", "LinkedIn"], ["Barcelona JUG", "X"],
    ["Software Crafters Barcelona", "LinkedIn"], ["Software Crafters Barcelona", "Bluesky"],
  ];
  for (const [account, network] of channels) {
    const post = reminderDay.getByRole("button", { name: `Seven channel event · ${account} · ${network} · Pendiente de revisión` });
    await expect(post).toContainText(`${account} · ${network} · Pendiente de revisión`);
    await post.focus();
    await page.keyboard.press("Enter");
    await expect(periodHeading).toHaveText(period!);
    await page.getByRole("button", { name: "✓ Aprobar y guardar ejemplo" }).click();
    await expect(reminderDay.getByRole("button", { name: `Seven channel event · ${account} · ${network} · Aprobada` })).toBeVisible();
  }

  // Simulate an uncertain provider result on a formerly hidden post; no Buffer call is made in demo mode.
  await expect.poll(() => page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem("findly-state-v1")!);
    return state.posts.filter((item: { date: string; status: string }) => item.date === date && item.status === "approved").length;
  }, reminderDate)).toBe(7);
  await page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem("findly-state-v1")!);
    const post = state.posts.find((item: { date: string; account: string; network: string }) => item.date === date && item.account === "Software Crafters Barcelona" && item.network === "Bluesky");
    post.status = "needs_reconciliation";
    post.lastError = "Resultado incierto simulado";
    localStorage.setItem("findly-state-v1", JSON.stringify(state));
  }, reminderDate);
  await page.reload();
  await reminderDay.getByRole("button", { name: `Mostrar 4 publicaciones más del ${reminderDate}` }).click();
  await reminderDay.getByRole("button", { name: "Seven channel event · Software Crafters Barcelona · Bluesky · Pendiente de conciliación" }).click();
  await expect(page.getByText("Resultado incierto simulado")).toBeVisible();
  await expect(page.getByLabel("ID confirmado del post de Buffer")).toBeVisible();
});

test("extracts event details from a pasted URL and lets the owner review the result", async ({ page }) => {
  const eventDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  await page.route("**/api/events/extract", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ url: "https://luma.com/community-night" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        event: { title: "Community Night", date: eventDate, time: "19:00", place: "Barcelona", description: "Meet the community.", url: "https://luma.com/community-night" },
        missingFields: [],
      }),
    });
  });

  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("URL del evento").fill("https://luma.com/community-night");
  await page.getByRole("button", { name: "Extraer datos del evento" }).click();
  await expect(page.getByLabel("TÍTULO")).toHaveValue("Community Night");
  await expect(page.getByLabel("FECHA")).toHaveValue(eventDate);
  await expect(page.getByLabel("HORA")).toHaveValue("19:00");
  await expect(page.getByLabel("LUGAR")).toHaveValue("Barcelona");
  await expect(page.getByLabel("DESCRIPCIÓN")).toHaveValue("Meet the community.");
  await expect(page.getByRole("status")).toHaveText("Datos extraídos. Revísalos antes de crear el evento.");

  await page.getByRole("button", { name: "Crear evento" }).click();
  await expect(page.getByRole("heading", { name: "Community Night", exact: true })).toBeVisible();
});

test("stores a Luma iCal source linked to multiple accounts", async ({ page }) => {
  await page.getByRole("button", { name: "Ajustes" }).click();
  await page.getByLabel("Nombre de la fuente").fill("BarcelonaJS Luma");
  await page.getByLabel("URL de suscripción iCal").fill("https://calendar.example.com/barcelonajs.ics");
  await page.getByRole("checkbox", { name: "Personal" }).check();
  await page.getByRole("checkbox", { name: "Barcelona JUG" }).check();
  await page.getByRole("button", { name: "Guardar fuente" }).click();

  const source = page.getByRole("article").filter({ hasText: "BarcelonaJS Luma" });
  await expect(source).toContainText("Luma · iCal");
  await expect(source).toContainText("Personal, Barcelona JUG");
  await expect(page.getByText("La demo guarda las fuentes en este navegador, pero no consulta feeds. Conecta Supabase para importar eventos.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sincronizar ahora" })).toBeDisabled();

  await source.getByRole("checkbox", { name: "Activa" }).uncheck();
  await page.reload();
  await page.getByRole("button", { name: "Ajustes" }).click();
  const restored = page.getByRole("article").filter({ hasText: "BarcelonaJS Luma" });
  await expect(restored.getByRole("checkbox", { name: "Activa" })).not.toBeChecked();
  await restored.getByRole("button", { name: "Eliminar" }).click();
  await expect(page.getByText("Aún no hay fuentes configuradas.")).toBeVisible();
});


test("active sends cannot be confirmed missing, while settled uncertain sends can", async ({ page }) => {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("findly-state-v1") ?? "{}");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    state.events = [{ id: "reconcile-event", title: "Reconciliation event", date, time: "19:00", place: "Barcelona", description: "", source: "Manual" }];
    state.posts = [{ id: "reconcile-post", eventId: "reconcile-event", date, time: "13:00", account: "Personal", network: "LinkedIn", text: "A post", status: "scheduling" }];
    localStorage.setItem("findly-state-v1", JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole("button", { name: /Reconciliation event/ }).click();
  await expect(page.getByText(/El envío puede seguir en curso/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar que está programada" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar ausencia y permitir reintento" })).toHaveCount(0);

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("findly-state-v1") ?? "{}");
    state.posts[0].status = "needs_reconciliation";
    localStorage.setItem("findly-state-v1", JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole("button", { name: /Reconciliation event/ }).click();
  await expect(page.getByRole("checkbox", { name: /He revisado el canal/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar ausencia y permitir reintento" })).toBeDisabled();
});
