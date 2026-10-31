# Planificador de publicaciones para eventos

Findly es una aplicación personal para preparar anuncios de eventos en varias cuentas sociales. El alcance acordado está en [docs/especificacion.md](docs/especificacion.md); la configuración y los servicios que aún faltan están en [docs/setup.md](docs/setup.md).

## Estado

La aplicación incluye:

- Un calendario con vistas quincenal, semanal y mensual. Cuando hay más de tres publicaciones en un día, el control «+N más» muestra todas con su cuenta, red y estado; cada una abre su detalle sin cambiar el intervalo.
- Alta manual con datos o pegando la URL pública de Meetup/Luma para extraer los datos disponibles, revisarlos y corregirlos antes de guardar.
- Borradores para LinkedIn, X y Bluesky, con fechas recordatorio a 14, 7 y 1 día del evento, a las 13:00 de `Europe/Madrid`. Se omiten las fechas cuyo horario ya pasó.
- Tres cuentas de ejemplo con prompts de voz editables, edición de borradores y validación local del límite de texto por red.
- Modos globales de revisión y automático. En revisión, una aprobación programa el texto en Buffer y guarda ese mismo texto como ejemplo de estilo; en automático, los borradores nuevos se programan al generarse, sin convertirse en ejemplos.
- IDs de canal de Buffer configurables por cuenta y red. Las publicaciones usan el instante `due_at` (13:00 `Europe/Madrid`) convertido a UTC y la programación exacta `customScheduled`.
- Estados persistentes para envíos en curso, confirmados, rechazados y resultados inciertos. Los resultados inciertos requieren conciliación manual; un envío en curso no se puede liberar como ausente ni reintentar. Las respuestas quedan vinculadas al intento que las originó.
- Un modo demo que guarda datos en el navegador y una ruta de persistencia con Supabase, autenticación de Google y acceso restringido al correo propietario.

En modo demo, el dashboard genera textos con plantillas locales y guarda los datos en el navegador; nunca llama a Buffer. Con Supabase, los eventos nuevos usan Groq en el servidor para generar cada borrador con la voz de la cuenta y ejemplos aprobados de la misma cuenta, red e idioma. Cada texto pasa por validación determinista antes de enviarse; si Groq falla o falta `GROQ_API_KEY` o `GROQ_MODEL`, el evento queda guardado y sus recordatorios pendientes se pueden reintentar. La sincronización Luma genera borradores para eventos recién importados o con recordatorios pendientes, usando las cuentas asociadas a la fuente; no regenera los ya existentes. En revisión, aprobar un texto añade un ejemplo de estilo y programa ese post en Buffer. En automático, los borradores nuevos se programan inmediatamente sin añadir ejemplos. Configura `BUFFER_API_KEY_PERSONAL`, `BUFFER_API_KEY_BARCELONA_JUG` y `BUFFER_API_KEY_SOFTWARE_CRAFTERS_BARCELONA` en el servidor, una clave por cuenta y los IDs de canal por cuenta/red en **Cuentas**. Los rechazos explícitos se pueden corregir y reintentar; si el resultado de Buffer es incierto, revisa la cola y registra su ID o confirma explícitamente que no existe antes de permitir un reintento. Mientras un envío esté en curso no se puede confirmar su ausencia. Si el proceso se interrumpe y la publicación no aparece en Buffer, el estado puede quedar bloqueado en `scheduling`: la aplicación aún no puede probar que el intento original haya terminado y no lo libera automáticamente. El estado `scheduled` indica que Buffer aceptó la programación, no que la red ya lo publicó. `POST /api/cron/sync` importa eventos Luma iCal habilitados y genera los recordatorios elegibles; el endpoint acepta una sesión same-origin del propietario para la ejecución manual o `CRON_SECRET` para los invocadores externos; el middleware deja pasar únicamente ese POST para que la ruta aplique esa autorización. Aún no hay una tarea cron externa configurada. Meetup no se sincroniza de forma automática; la extracción manual desde URLs públicas de eventos está limitada a los datos publicados en su HTML.

El repositorio no incluye credenciales de proveedor ni un despliegue de producción. En un espacio conectado, **Ajustes → Fuentes** permite iniciar la sincronización Luma manualmente; cron-job.org puede invocar el mismo endpoint cada seis horas con `CRON_SECRET`. La demo no consulta feeds. La programación está implementada con pruebas mock; antes de usarla en producción, configura los canales y valida el resultado con cuentas reales. La sincronización de cambios de fecha y cancelaciones queda fuera de la primera fase.

## Desarrollo local

Requiere la versión de Node.js indicada por el entorno de CI (Node.js 22).

```bash
npm ci
npm run dev
```

Abre http://localhost:3000. Sin variables de Supabase, la aplicación inicia en modo demo. Para configurar persistencia y acceso con Google, sigue [docs/setup.md](docs/setup.md) y usa `.env.example` como referencia; las credenciales reales no deben añadirse al repositorio. La validación y aplicación automática de migraciones se describe en [docs/database-migrations.md](docs/database-migrations.md).

## Comprobaciones

```bash
npm run lint
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
```

Los tests unitarios usan fixtures y `fetch` simulado; los E2E usan el modo demo local. Ninguno verifica integraciones reales con Supabase, Groq, Buffer, Luma ni Meetup. CI ejecuta lint, tests unitarios, build, cobertura de lógica, migraciones contra Postgres local y Playwright. Después de fusionar cambios de migración a `main`, GitHub Actions aplica las migraciones pendientes si las credenciales de despliegue están configuradas. La protección de `main` debe exigir `Coverage (80%)`, `Database migrations`, `Documentation and Sync` y `E2E (Playwright)`.
