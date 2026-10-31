# Planificador de publicaciones para eventos

## Objetivo

Detectar eventos y preparar anuncios para las cuentas personales y de asociaciones, con una voz propia por cuenta y programación mediante Buffer.

## Alcance acordado

- Un usuario autorizado inicia sesión con Google mediante Supabase.
- Las fuentes pueden asociarse a varias cuentas de Buffer y a sus canales. Luma se consulta mediante suscripción iCal; Meetup queda pendiente de verificar con una fuente real.
- Un evento también puede añadirse por URL, con extracción y corrección manual de sus datos.
- Las publicaciones se generan con Groq para cada cuenta, canal y fecha aplicable. El idioma se infiere del título; si no es claro se usa inglés.
- Las fechas previstas son 14, 7 y 1 día antes del evento, a las 13:00 en Europe/Madrid. Se omiten las fechas que ya hayan pasado.
- Un ajuste global selecciona revisión o programación automática. En revisión, una aprobación guarda la versión final como ejemplo de estilo y la prepara para programar. Los ejemplos se filtran por cuenta, idioma y red; cada cuenta dispone de su propio system prompt.
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
- Establecer un mecanismo seguro de conciliación de resultados inciertos de Buffer y comprobación de estados publicados.

## Infraestructura propuesta

Next.js en Vercel, Supabase para Postgres y autenticación Google, Groq para generación, Buffer para programación y cron-job.org como invocador. Las claves permanecen en el servidor. El proyecto requiere configurar los servicios externos antes de utilizar el flujo completo.
