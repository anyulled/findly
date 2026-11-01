import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/workspace");
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

  const now = new Date();
  const currentMonthText = now.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthText = nextMonthDate.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const periodHeading = page.getByRole("heading", { level: 2 }).first();
  await expect(periodHeading).toHaveText(currentMonthText);

  await page.getByRole("button", { name: "Periodo siguiente" }).click();
  await expect(periodHeading).toHaveText(nextMonthText);

  await page.getByRole("button", { name: "Periodo anterior" }).click();
  await expect(periodHeading).toHaveText(currentMonthText);
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
  await expect(page.getByText("Origen de generación desconocido para esta publicación.")).toBeVisible();
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
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("BarcelonaJS Luma");
    void dialog.accept();
  });
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

test("deletes an event from the events list", async ({ page }) => {
  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("TÍTULO").fill("Temporary Event to Delete");
  await page.getByLabel("FECHA").fill("2026-12-15");
  await page.getByLabel("HORA").fill("10:00");
  await page.getByRole("button", { name: "Crear evento" }).click();

  await expect(page.getByRole("heading", { name: "Temporary Event to Delete" })).toBeVisible();
  const eventCard = page.getByRole("article").filter({ hasText: "Temporary Event to Delete" });
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Temporary Event to Delete");
    void dialog.accept();
  });
  await eventCard.getByRole("button", { name: /Eliminar evento/ }).click();
  await expect(page.getByRole("heading", { name: "Temporary Event to Delete" })).toHaveCount(0);
});


test("creates an event for selected accounts only and retains the selection after reload", async ({ page }) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 30)).toISOString().slice(0, 10);
  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("TÍTULO").fill("Selected account event");
  await page.getByLabel("FECHA").fill(date);
  await page.getByLabel("HORA").fill("19:00");
  await page.getByRole("checkbox", { name: "Barcelona JUG" }).uncheck();
  await page.getByRole("checkbox", { name: "Software Crafters Barcelona" }).uncheck();
  await page.getByRole("checkbox", { name: "Personal" }).uncheck();
  await expect(page.getByRole("button", { name: "Crear evento" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Personal" }).check();
  await page.getByRole("button", { name: "Crear evento" }).click();
  await expect(page.getByText("9 publicaciones previstas")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Eventos" }).click();
  await expect(page.getByText("9 publicaciones previstas")).toBeVisible();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("findly-state-v1") ?? "{}"));
  expect(state.events[0].accountIds).toEqual(["acc-personal"]);
  expect([...new Set(state.posts.map((post: { account: string }) => post.account))]).toEqual(["Personal"]);
});

test("discards a review draft and preserves scheduled posts", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await page.evaluate((date) => localStorage.setItem("findly-state-v1", JSON.stringify({
    events: [{ id: "draft-event", title: "Borrado de prueba", date, time: "19:00", place: "Barcelona", description: "Prueba", source: "Manual" }],
    posts: [
      { id: "draft-one", eventId: "draft-event", date, time: "13:00", account: "Personal", network: "LinkedIn", text: "Borrador de prueba", status: "review" },
      { id: "scheduled-one", eventId: "draft-event", date, time: "14:00", account: "Personal", network: "X", text: "Programada", status: "scheduled", bufferPostId: "buffer-id" },
    ], mode: "review",
  })), today);
  await page.reload();
  await page.getByRole("button", { name: "Borrado de prueba · Personal · LinkedIn · Pendiente de revisión" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Eliminar borrador" }).click();
  await expect(page.getByText("Borrador eliminado.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Borrado de prueba · Personal · LinkedIn · Pendiente de revisión" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Borrado de prueba · Personal · LinkedIn · Pendiente de revisión" })).toHaveCount(0);
  await page.getByRole("button", { name: "Borrado de prueba · Personal · X · Programada" }).click();
  await expect(page.getByRole("button", { name: "Eliminar borrador" })).toHaveCount(0);
});

test("shows safe generation diagnostics on the affected draft", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await page.evaluate((date) => localStorage.setItem("findly-state-v1", JSON.stringify({
    events: [{ id: "diagnostic-event", title: "Diagnostic event", date, time: "19:00", place: "", description: "", source: "Manual" }],
    posts: [{ id: "diagnostic-post", eventId: "diagnostic-event", date, time: "13:00", account: "Personal", network: "LinkedIn", text: "Basic text", status: "review", generationOrigin: "fallback", generationErrorCode: "rate_limited" }],
    mode: "review",
  })), today);
  await page.reload();
  await page.getByRole("button", { name: "Calendario" }).click();
  await page.getByRole("button", { name: /Diagnostic event.*Personal.*LinkedIn/ }).click();
  await expect(page.getByText(/No se pudo generar con Groq; se creó un borrador básico/)).toBeVisible();
  await expect(page.getByText(/Groq alcanzó su límite de solicitudes/)).toBeVisible();
});

test("cancelling deletion confirmation leaves the item unchanged", async ({ page }) => {
  await page.getByRole("button", { name: "Añadir evento" }).first().click();
  await page.getByLabel("TÍTULO").fill("Event Kept After Cancel");
  await page.getByLabel("FECHA").fill("2026-12-20");
  await page.getByLabel("HORA").fill("11:00");
  await page.getByRole("button", { name: "Crear evento" }).click();

  const eventCard = page.getByRole("article").filter({ hasText: "Event Kept After Cancel" });
  await expect(eventCard).toBeVisible();

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Event Kept After Cancel");
    void dialog.dismiss();
  });
  await eventCard.getByRole("button", { name: /Eliminar evento/ }).click();
  await expect(page.getByRole("heading", { name: "Event Kept After Cancel" })).toBeVisible();
});

test("navigates to Revisiones tab, filters posts, approves single and batch, and sees empty state", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("findly-state-v1", JSON.stringify({
    events: [
      { id: "rev-ev-1", title: "Review Event Alpha", date: "2026-11-15", time: "18:00", place: "Madrid", description: "Alpha event", source: "Manual" },
    ],
    posts: [
      { id: "rev-post-1", eventId: "rev-ev-1", date: "2026-11-14", time: "10:00", account: "Personal", network: "LinkedIn", text: "Text for Alpha LinkedIn", status: "review" },
      { id: "rev-post-2", eventId: "rev-ev-1", date: "2026-11-14", time: "11:00", account: "Personal", network: "X", text: "Text for Alpha X", status: "review" },
      { id: "rev-post-3", eventId: "rev-ev-1", date: "2026-11-14", time: "12:00", account: "Personal", network: "Bluesky", text: "Text for Alpha Bluesky failed", status: "failed", lastError: "Buffer channel disconnected" },
    ],
    mode: "review",
  })));

  await page.reload();

  // The sidebar should show Revisiones with badge 3 (2 review + 1 failed)
  const reviewsNav = page.getByRole("button", { name: /Revisiones/ });
  await expect(reviewsNav).toBeVisible();
  await expect(reviewsNav).toContainText("3");

  await reviewsNav.click();
  await expect(page.getByRole("heading", { name: "Revisiones", level: 1 })).toBeVisible();

  // Test filters
  await page.getByRole("button", { name: /Pendientes de revisión/ }).click();
  await expect(page.getByText("Text for Alpha LinkedIn")).toBeVisible();
  await expect(page.getByText("Text for Alpha Bluesky failed")).toHaveCount(0);

  await page.getByRole("button", { name: /Fallidas/ }).click();
  await expect(page.getByText("Text for Alpha Bluesky failed")).toBeVisible();
  await expect(page.getByText("Error de Buffer: Buffer channel disconnected")).toBeVisible();
  await expect(page.getByText("Text for Alpha LinkedIn")).toHaveCount(0);

  // Return to all
  await page.getByRole("button", { name: /^Todas/ }).click();

  // Test opening modal via Editar
  await page.getByRole("button", { name: "✎ Editar" }).first().click();
  await expect(page.getByRole("heading", { name: "Review Event Alpha" }).last()).toBeVisible();
  await page.getByRole("button", { name: "×" }).click();

  // Test batch approve for the event
  const batchApproveBtn = page.getByRole("button", { name: /Aprobar todas/ });
  await expect(batchApproveBtn).toContainText("2");
  await batchApproveBtn.click();

  // Now only the failed post remains in Revisiones
  await expect(page.getByText("Text for Alpha LinkedIn")).toHaveCount(0);
  await expect(page.getByText("Text for Alpha Bluesky failed")).toBeVisible();
  await expect(reviewsNav).toContainText("1");

  // Discard/remove the failed post
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("button", { name: "✕ Eliminar" }).click();

  // Empty state should now be displayed
  await expect(page.getByRole("heading", { name: "¡Todo al día!" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver Calendario" })).toBeVisible();
});
