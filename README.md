# Planificador de publicaciones para eventos

Findly es una aplicación personal para preparar anuncios de eventos en varias cuentas sociales. El alcance acordado está en [docs/especificacion.md](docs/especificacion.md); la configuración y los servicios que aún faltan están en [docs/setup.md](docs/setup.md).

## Estado

La aplicación incluye:

- Un calendario con vistas quincenal, semanal y mensual.
- Alta manual de eventos y borradores para LinkedIn, X y Bluesky, con fechas recordatorio a 14, 7 y 1 día del evento, a las 13:00 de `Europe/Madrid`. Se omiten las fechas cuyo horario ya pasó.
- Tres cuentas de ejemplo con prompts de voz editables, edición de borradores y validación local del límite de texto por red.
- Modos globales de revisión y automático en la interfaz. Aprobar un borrador lo guarda también como ejemplo de estilo.
- Un modo demo que guarda datos en el navegador y una ruta de persistencia con Supabase, autenticación de Google y acceso restringido al correo propietario.

La generación actual usa plantillas locales y no utiliza los prompts de voz ni los ejemplos aprobados. **Groq todavía no redacta publicaciones, Buffer no recibe ni programa contenido y el modo automático no publica.** Los eventos se introducen manualmente; la aplicación no importa calendarios iCal de Luma ni extrae eventos de Meetup. Tampoco hay endpoint de sincronización ni tarea cron configurados.

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
npm run build
npx playwright install chromium
npm run test:e2e
```

Los E2E usan el modo demo local y no verifican integraciones reales con Supabase, Groq, Buffer, Luma ni Meetup. CI ejecuta lint, build y Playwright; el check `E2E (Playwright)` es obligatorio para fusionar en `main`.
