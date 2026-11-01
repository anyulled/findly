# Planificador de publicaciones para eventos

## Objetivo

Detectar eventos y preparar anuncios para las cuentas personales y de asociaciones, con una voz propia por cuenta y programación mediante Buffer.

## Alcance acordado

- Un usuario autorizado inicia sesión con Google mediante Supabase.
- Las fuentes pueden asociarse a varias cuentas de Buffer y a sus canales. Luma se consulta mediante suscripción iCal; Meetup queda pendiente de verificar con una fuente real. Los eventos importados solo generan y programan recordatorios para las cuentas habilitadas vinculadas a su fuente, también al completar recordatorios o reintentar; si no hay cuentas vinculadas no se generan publicaciones. Los eventos manuales usan todas las cuentas habilitadas. Una fuente con eventos importados no se elimina físicamente: **Retirar** la archiva (`archived_at`) y la desactiva, conserva eventos, publicaciones y ejemplos y la excluye de las sincronizaciones posteriores; **Activa** solo pausa la sincronización y **Eliminar** queda para fuentes sin eventos. Volver a añadir el mismo feed crea una fuente nueva y puede reimportar sus eventos.
- Un evento también puede añadirse por URL, con extracción y corrección manual de sus datos.
- Las publicaciones se generan con Groq para cada cuenta, canal y fecha aplicable. El idioma se infiere del título; si no es claro se usa inglés.
- Las fechas previstas son 14, 7 y 1 día antes del evento, a las 13:00 en Europe/Madrid. Se omiten las fechas que ya hayan pasado.
- Un ajuste global selecciona revisión o programación automática. En revisión, una aprobación guarda atómicamente el texto final como ejemplo de estilo y programa ese post. En automático, los borradores nuevos se programan al generarse y no se convierten en ejemplos. Los ejemplos se filtran por cuenta, idioma y red; cada cuenta dispone de su propio system prompt.
- Cada cuenta configura un ID de canal de Buffer por red conectada. La hora `due_at` de Madrid se convierte a un instante UTC para `customScheduled`.
- La validación de límites de las redes es determinista. Las ejecuciones repetidas y concurrentes no deben crear publicaciones duplicadas; un resultado remoto incierto requiere reconciliación antes de reintentar.
- La vista de calendario permite semanas, quincenas y meses; por defecto muestra la semana actual y la siguiente, empezando el lunes, en hora de Madrid. Incluye estados y detalle de publicaciones.
- Una tarea invocable mediante endpoint autenticado consulta las fuentes cada seis horas mediante cron-job.org. La aplicación permite iniciar la misma tarea manualmente.
- Se registran los estados de detección, revisión, programación, publicación y error; una programación aceptada no equivale a publicación efectiva.

## Fuera de alcance inicial

- Sincronización automática de cambios de fecha y cancelaciones. Las publicaciones previamente programadas deberán gestionarse manualmente.
- Importar o pegar publicaciones históricas como ejemplos.
- Otros usuarios y permisos de equipo.

## Decisiones y comprobaciones pendientes

- Comprobar con URLs reales qué datos proporcionan Luma iCal y Meetup, y completar los ausentes de forma fiable.
- Verificar credenciales, organizaciones, canales, cuotas y capacidades concretas de las tres cuentas de Buffer.
- Definir y probar reglas de longitud por red, incluidas URLs y Unicode, con las capacidades reales de Buffer.
- Verificar condiciones de uso y límites del plan de alojamiento para actividades de asociaciones.
- Concretar el uso de Jev solo si aporta valor medible en decisiones no deterministas.
- Comprobar las organizaciones, canales, permisos, cuotas y programación exacta con las cuentas reales de Buffer. El estado programado confirma aceptación de Buffer, no publicación social.
- Integrar comprobación posterior de publicaciones sociales; la primera fase no marca publicaciones como `published`.

## Infraestructura propuesta

Next.js en Vercel, Supabase para Postgres y autenticación Google, Groq para generación, Buffer para programación y cron-job.org como invocador. Las claves permanecen en el servidor. El proyecto requiere configurar los servicios externos antes de utilizar el flujo completo.
