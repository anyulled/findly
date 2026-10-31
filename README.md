# Planificador de publicaciones para eventos

Findly es una aplicación personal para preparar anuncios de eventos en varias cuentas sociales. El alcance acordado está en [docs/especificacion.md](docs/especificacion.md); la configuración y los servicios que aún faltan están en [docs/setup.md](docs/setup.md).

## Estado

La aplicación incluye:

- Un calendario con vistas quincenal, semanal y mensual.
- Alta manual de eventos y borradores para LinkedIn, X y Bluesky, con fechas recordatorio a 14, 7 y 1 día del evento, a las 13:00 de `Europe/Madrid`. Se omiten las fechas cuyo horario ya pasó.
- Tres cuentas de ejemplo con prompts de voz editables, edición de borradores y validación local del límite de texto por red.
- Modos globales de revisión y automático en la interfaz. Aprobar un borrador lo guarda también como ejemplo de estilo.
- Un modo demo que guarda datos en el navegador y una ruta de persistencia con Supabase, autenticación de Google y acceso restringido al correo propietario.

En modo demo, el dashboard genera textos con plantillas locales y guarda los datos en el navegador. Con Supabase, los eventos nuevos usan Groq en el servidor para generar cada borrador con la voz de la cuenta y ejemplos aprobados de la misma cuenta, red e idioma. Cada texto pasa por la validación determinista del límite de la red; si Groq falla o falta `GROQ_API_KEY` o `GROQ_MODEL`, el evento queda guardado y se pueden reintentar sus recordatorios. La sincronización de Luma crea borradores para eventos recién importados o con recordatorios pendientes, usando las cuentas asociadas a la fuente cuando Groq está configurado; nunca vuelve a generar recordatorios ya existentes y reintenta los que faltan en la siguiente sincronización. **Los borradores siguen pendientes de revisión y Buffer aún no programa ni publica; el modo automático no activa envíos hasta que se integre ese flujo.** `POST /api/cron/sync` importa eventos nuevos desde feeds Luma iCal habilitados; el middleware de sesión deja pasar únicamente ese POST para que el endpoint valide `CRON_SECRET`. Aún no hay una tarea cron externa configurada. Meetup no se sincroniza ni se extrae.

El código de autenticación y persistencia está preparado, pero este repositorio no incluye credenciales, configuración de proveedores ni un despliegue de producción. La aplicación no está lista para publicación automática hasta conectar y validar esos servicios. La sincronización de cambios de fecha y cancelaciones queda fuera de la primera fase.

## Desarrollo local

Requiere la versión de Node.js indicada por el entorno de CI (Node.js 22).

```bash
npm ci
npm run dev
```

Abre http://localhost:3000. Sin variables de Supabase, la aplicación inicia en modo demo. Para configurar persistencia y acceso con Google, sigue [docs/setup.md](docs/setup.md) y usa `.env.example` como referencia; las credenciales reales no deben añadirse al repositorio.

## Comprobaciones

```bash
npm run lint
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
```

Los tests unitarios usan fixtures y `fetch` simulado; los E2E usan el modo demo local. Ninguno verifica integraciones reales con Supabase, Groq, Buffer, Luma ni Meetup. CI ejecuta lint, tests unitarios, build y Playwright. El checklist de Documentación y Sincronización de la plantilla de PR ya se valida en CI, y la protección de `main` debe exigir este check junto a `E2E (Playwright)`.
